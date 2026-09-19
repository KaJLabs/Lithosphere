#!/usr/bin/env python3
"""Run MultX checks against disposable loopback services; never use mainnet."""
import argparse
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import tempfile
import time


def port(value):
    parsed = int(value)
    if parsed < 1 or parsed > 65535:
        raise argparse.ArgumentTypeError('port must be between 1 and 65535')
    return parsed


parser = argparse.ArgumentParser()
parser.add_argument('--evidence', required=True)
parser.add_argument('--phase', choices=['core', 'packages', 'web', 'browser', 'all'], default='all')
parser.add_argument('--api-tests', nargs='+', help='Run only these API test/*.js files in the disposable lab')
parser.add_argument('--node-bin-dir', default=os.environ.get('MULTX_REVIEW_NODE_BIN_DIR'))
parser.add_argument('--postgres-bin-dir', default=os.environ.get('MULTX_REVIEW_POSTGRES_BIN_DIR'))
parser.add_argument('--postgres-library-dir', default=os.environ.get('MULTX_REVIEW_POSTGRES_LIBRARY_DIR'))
parser.add_argument('--postgres-pkglib-dir', default=os.environ.get('MULTX_REVIEW_POSTGRES_PKGLIB_DIR'))
parser.add_argument('--postgres-port', type=port, default=int(os.environ.get('MULTX_REVIEW_PG_PORT', '55441')))
parser.add_argument('--source-port', type=port, default=int(os.environ.get('MULTX_REVIEW_SOURCE_PORT', '18547')))
parser.add_argument('--destination-port', type=port, default=int(os.environ.get('MULTX_REVIEW_DESTINATION_PORT', '18546')))
parser.add_argument('--web-port', type=port, default=int(os.environ.get('MULTX_REVIEW_WEB_PORT', '4178')))
parser.add_argument('--db-user', default=os.environ.get('MULTX_REVIEW_PG_USER', 'multx_review'))
parser.add_argument('--db-database', default=os.environ.get('MULTX_REVIEW_PG_DATABASE', 'postgres'))
parser.add_argument('--browser-lib-dir', default=os.environ.get('MULTX_REVIEW_BROWSER_LIBRARY_DIR'))
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
evidence = Path(args.evidence).resolve()
evidence.mkdir(parents=True, exist_ok=True)


def find_program(name, directory=None):
    candidate = Path(directory).resolve() / name if directory else shutil.which(name)
    if not candidate or not Path(candidate).is_file():
        option = name.replace('_', '-').replace('pg-ctl', 'postgres-bin-dir')
        raise SystemExit(f'{name} not found; install it or configure its binary directory')
    return str(candidate)


path_entries = []
if args.node_bin_dir:
    path_entries.append(str(Path(args.node_bin_dir).resolve()))
if args.postgres_bin_dir:
    path_entries.append(str(Path(args.postgres_bin_dir).resolve()))
path_entries.append(os.environ.get('PATH', os.defpath))
env = dict(os.environ, PATH=os.pathsep.join(path_entries))
env.pop('DEPLOYER_PRIVATE_KEY', None)
node = find_program('node', args.node_bin_dir)
npm = find_program('npm', args.node_bin_dir)
results = []


def check(name, command, directory, extra=None):
    started = time.time()
    print('RUN ' + name, flush=True)
    with (evidence / (name + '.log')).open('w') as output:
        result = subprocess.run(command, cwd=root / directory, env={**env, **(extra or {})},
                                stdout=output, stderr=subprocess.STDOUT, timeout=1800)
    results.append({'name': name, 'command': command, 'cwd': directory, 'exitCode': result.returncode,
                    'seconds': round(time.time() - started, 2)})
    (evidence / ('results-' + args.phase + '.json')).write_text(json.dumps(results, indent=2) + '\n')
    print(('PASS ' if result.returncode == 0 else 'FAIL ') + name, flush=True)
    if result.returncode:
        print((evidence / (name + '.log')).read_text()[-6000:], flush=True)
        raise SystemExit(result.returncode)


def listening(value):
    with socket.socket() as connection:
        connection.settimeout(0.3)
        return connection.connect_ex(('127.0.0.1', value)) == 0


def core_checks():
    # The local-chain API integration tests deploy the exact Hardhat artifacts.
    # Compile them here so the core phase is reproducible from a clean checkout
    # instead of depending on a previous package-phase or developer build.
    check('contracts-compile', [npm, 'run', 'compile'], 'contracts')
    check('sdk-tests', [npm, 'test'], 'sdk')
    check('sdk-build', [npm, 'run', 'build'], 'sdk')
    ports = (args.postgres_port, args.destination_port, args.source_port)
    if len(set(ports)) != len(ports):
        raise SystemExit('review service ports must be distinct')
    for value in ports:
        if listening(value):
            raise SystemExit('Refusing to reuse an unknown service on port ' + str(value))
    pgctl = find_program('pg_ctl', args.postgres_bin_dir)
    initdb = find_program('initdb', args.postgres_bin_dir)
    pgenv = dict(env)
    if args.postgres_library_dir:
        current = pgenv.get('LD_LIBRARY_PATH')
        pgenv['LD_LIBRARY_PATH'] = str(Path(args.postgres_library_dir).resolve()) + (os.pathsep + current if current else '')
    processes, streams = [], []
    with tempfile.TemporaryDirectory(prefix='multx-review-pg-') as temporary:
        pgdata = Path(temporary) / 'data'
        socket_dir = Path(temporary) / 'socket'
        with (evidence / 'postgres-init.log').open('w') as output:
            initialized = subprocess.run([initdb, '-D', str(pgdata), '--username', args.db_user,
                '--auth-host=trust', '--auth-local=trust', '--encoding=UTF8', '--no-locale'],
                env=pgenv, stdout=output, stderr=subprocess.STDOUT, timeout=120)
        if initialized.returncode:
            raise SystemExit('PostgreSQL initdb failed; inspect postgres-init.log')
        socket_dir.mkdir()
        server_options = f'-p {args.postgres_port} -h 127.0.0.1 -k {socket_dir}'
        if args.postgres_pkglib_dir:
            server_options += ' -c dynamic_library_path=' + str(Path(args.postgres_pkglib_dir).resolve())
        pgstarted = False
        try:
            subprocess.run([pgctl, '-D', str(pgdata), '-l', str(evidence / 'postgres.log'),
                            '-o', server_options, '-w', '-t', '60', 'start'], env=pgenv, check=True, timeout=75)
            pgstarted = True
            for value, config in [(args.destination_port, 'hardhat.payout-local.config.cjs'),
                                  (args.source_port, 'hardhat.source-local.config.cjs')]:
                stream = (evidence / ('local-node-' + str(value) + '.log')).open('w')
                streams.append(stream)
                process = subprocess.Popen([node, 'node_modules/hardhat/internal/cli/cli.js', 'node', '--config', config, '--port', str(value)],
                    cwd=root / 'contracts', env=env, stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
                processes.append(process)
                deadline = time.time() + 180
                while not listening(value):
                    if process.poll() is not None or time.time() > deadline:
                        raise RuntimeError('Local node did not start on ' + str(value))
                    time.sleep(0.5)
            if args.api_tests and any(not name.startswith('test/') or not name.endswith('.js') or '..' in Path(name).parts for name in args.api_tests):
                raise SystemExit('API test paths must stay under test/')
            test_env = {
                'MULTX_CROSS_CHAIN_TEST': '1', 'MULTX_PAYOUT_DB_TEST': '1',
                'MULTX_PAYOUT_LOCAL_EVM': '1', 'MULTX_LOCAL_DEX_TEST': '1',
                'MULTX_REVIEW_PG_HOST': '127.0.0.1', 'MULTX_REVIEW_PG_PORT': str(args.postgres_port),
                'MULTX_REVIEW_PG_USER': args.db_user, 'MULTX_REVIEW_PG_DATABASE': args.db_database,
                'MULTX_REVIEW_SOURCE_RPC': f'http://127.0.0.1:{args.source_port}',
                'MULTX_REVIEW_DESTINATION_RPC': f'http://127.0.0.1:{args.destination_port}',
            }
            check('api-targeted-tests' if args.api_tests else 'api-full-tests',
                  [node, '--test', '--test-concurrency=1', *(args.api_tests or [])], 'api', test_env)
        finally:
            for process in processes:
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGTERM)
                    process.wait(timeout=15)
            for stream in streams:
                stream.close()
            if pgstarted:
                subprocess.run([pgctl, '-D', str(pgdata), 'stop', '-m', 'fast', '-w', '-t', '60'],
                               env=pgenv, check=True, timeout=75)


if args.phase in ('core', 'all'):
    core_checks()
if args.phase in ('packages', 'all'):
    check('contracts-tests', [npm, 'test'], 'contracts')
    if args.phase == 'packages':
        check('contracts-compile', [npm, 'run', 'compile'], 'contracts')
    check('signer-tests', [npm, 'test'], 'signer')
if args.phase in ('web', 'packages', 'all'):
    check('web-lint', [npm, 'run', 'lint'], 'web')
    check('web-unit-tests', [npm, 'run', 'test:unit'], 'web')
    if args.phase != 'web':
        check('web-build', [npm, 'run', 'build'], 'web')
if args.phase in ('browser', 'all'):
    browser_env = {'MULTX_REVIEW_WEB_PORT': str(args.web_port)}
    if args.browser_lib_dir:
        browser_env['LD_LIBRARY_PATH'] = str(Path(args.browser_lib_dir).resolve())
    check('browser-recovery', [node, 'node_modules/playwright/cli.js', 'test', '--config', 'playwright.native.config.js',
                              '--output', str(evidence / 'browser-results')], 'web', browser_env)
