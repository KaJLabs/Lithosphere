/**
 * create-litho-app CLI
 * Scaffold new Lithosphere projects from templates
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import chalk from 'chalk';
import { Command } from 'commander';
import fs from 'fs-extra';
import inquirer from 'inquirer';
import ora from 'ora';

/*//////////////////////////////////////////////////////////////
                          CONSTANTS
//////////////////////////////////////////////////////////////*/

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI_VERSION = readPackageVersion();
const EXCLUDED_TEMPLATE_PATH_PARTS = new Set([
  '.turbo',
  'artifacts',
  'broadcast',
  'cache',
  'coverage',
  'dist',
  'forge-cache',
  'node_modules',
  'typechain-types',
]);

// Template definitions
const TEMPLATES = {
  contracts: {
    name: 'Smart Contracts (Hardhat + Foundry)',
    value: 'contracts',
    folder: 'contracts-template',
    description: 'Hybrid smart contract development with Hardhat and Foundry',
  },
  service: {
    name: 'Microservice (Fastify + Docker)',
    value: 'service',
    folder: 'service-template',
    description: 'Production-ready Node.js microservice with Fastify',
  },
  sdk: {
    name: 'TypeScript SDK',
    value: 'sdk',
    folder: 'sdk-template',
    description: 'TypeScript SDK library with tsup bundling',
  },
} as const;

type TemplateType = keyof typeof TEMPLATES;

/*//////////////////////////////////////////////////////////////
                          CLI SETUP
//////////////////////////////////////////////////////////////*/

const program = new Command();

program
  .name('create-litho-app')
  .description('Scaffold new Lithosphere projects from templates')
  .version(CLI_VERSION)
  .argument('[project-name]', 'Name of the project to create')
  .option('-t, --template <template>', 'Template to use (contracts, service, sdk)')
  .option('-d, --directory <dir>', 'Output directory (default: apps/)')
  .action(async (projectName?: string, options?: { template?: string; directory?: string }) => {
    await run(projectName, options);
  });

program.parse();

/*//////////////////////////////////////////////////////////////
                          MAIN LOGIC
//////////////////////////////////////////////////////////////*/

async function run(
  projectName?: string,
  options?: { template?: string; directory?: string }
): Promise<void> {
  console.log();
  console.log(chalk.bold.cyan('🚀 create-litho-app'));
  console.log(chalk.gray('Scaffold new Lithosphere projects\n'));

  try {
    // Step 1: Get project name
    const name = await getProjectName(projectName);

    // Step 2: Get template selection
    const template = await getTemplate(options?.template);

    // Step 3: Determine output directory
    const outputDir = options?.directory ?? 'apps';
    const targetPath = path.resolve(process.cwd(), outputDir, name);

    // Step 4: Check if directory already exists
    if (await fs.pathExists(targetPath)) {
      const { overwrite } = await inquirer.prompt<{ overwrite: boolean }>([
        {
          type: 'confirm',
          name: 'overwrite',
          message: chalk.yellow(`Directory ${chalk.bold(name)} already exists. Overwrite?`),
          default: false,
        },
      ]);

      if (!overwrite) {
        console.log(chalk.red('\n✖ Aborted.'));
        process.exit(1);
      }

      await fs.remove(targetPath);
    }

    // Step 5: Copy template
    const spinner = ora(`Creating ${chalk.cyan(name)} from ${chalk.green(TEMPLATES[template].name)}...`).start();

    const templatePath = resolveTemplatePath(template);

    if (!(await fs.pathExists(templatePath))) {
      spinner.fail(chalk.red(`Template not found at: ${templatePath}`));
      process.exit(1);
    }

    await fs.copy(templatePath, targetPath, {
      filter: (src: string) => {
        const relativePath = path.relative(templatePath, src);
        return shouldIncludeTemplatePath(relativePath);
      },
    });

    spinner.succeed(`Created project structure`);

    // Step 6: Update package.json with project name
    const packageJsonPath = path.join(targetPath, 'package.json');
    if (await fs.pathExists(packageJsonPath)) {
      const updateSpinner = ora('Updating package.json...').start();

      const packageJson = await fs.readJson(packageJsonPath);
      packageJson.name = name;
      packageJson.version = '0.1.0';
      await fs.writeJson(packageJsonPath, packageJson, { spaces: 2 });

      updateSpinner.succeed('Updated package.json');
    }

    // Step 7: Print success message
    console.log();
    console.log(chalk.green.bold('✔ Project created successfully!'));
    console.log();
    console.log(chalk.white('Next steps:'));
    console.log();
    console.log(chalk.gray('  1.'), chalk.cyan(`cd ${path.relative(process.cwd(), targetPath)}`));
    console.log(chalk.gray('  2.'), chalk.cyan('pnpm install --ignore-workspace'));

    // Template-specific instructions
    switch (template) {
      case 'contracts':
        console.log(chalk.gray('  3.'), chalk.cyan('pnpm compile'));
        console.log(chalk.gray('  4.'), chalk.cyan('pnpm test'));
        break;
      case 'service':
        console.log(chalk.gray('  3.'), chalk.cyan('cp .env.example .env'));
        console.log(chalk.gray('  4.'), chalk.cyan('pnpm dev'));
        break;
      case 'sdk':
        console.log(chalk.gray('  3.'), chalk.cyan('pnpm build'));
        console.log(chalk.gray('  4.'), chalk.cyan('pnpm test'));
        break;
    }

    console.log();
    console.log(chalk.gray('Note: Use --ignore-workspace to install dependencies locally'));
    console.log(chalk.gray('Happy coding! 🎉'));
    console.log();
  } catch (error) {
    if (error instanceof Error) {
      console.error(chalk.red(`\n✖ Error: ${error.message}`));
    }
    process.exit(1);
  }
}

/*//////////////////////////////////////////////////////////////
                          HELPERS
//////////////////////////////////////////////////////////////*/

/**
 * Read the package version from package.json so release tarballs report the correct version.
 */
function readPackageVersion(): string {
  const packageJsonPath = path.resolve(__dirname, '..', 'package.json');

  try {
    if (fs.pathExistsSync(packageJsonPath)) {
      const packageJson = fs.readJsonSync(packageJsonPath) as { version?: string };
      if (packageJson.version) {
        return packageJson.version;
      }
    }
  } catch {
    // Fall back to the default version when package metadata is unavailable.
  }

  return '0.1.0';
}

/**
 * Get project name from argument or prompt
 */
async function getProjectName(projectName?: string): Promise<string> {
  if (projectName) {
    return validateProjectName(projectName);
  }

  const { name } = await inquirer.prompt<{ name: string }>([
    {
      type: 'input',
      name: 'name',
      message: 'What is your project name?',
      default: 'my-litho-app',
      validate: (input: string) => {
        if (!input.trim()) {
          return 'Project name is required';
        }
        if (!/^[a-z0-9-_]+$/i.test(input)) {
          return 'Project name can only contain letters, numbers, hyphens, and underscores';
        }
        return true;
      },
    },
  ]);

  return name;
}

/**
 * Validate project name format
 */
function validateProjectName(name: string): string {
  if (!name.trim()) {
    throw new Error('Project name is required');
  }
  if (!/^[a-z0-9-_]+$/i.test(name)) {
    throw new Error('Project name can only contain letters, numbers, hyphens, and underscores');
  }
  return name;
}

/**
 * Get template selection from option or prompt
 */
async function getTemplate(template?: string): Promise<TemplateType> {
  if (template) {
    if (template in TEMPLATES) {
      return template as TemplateType;
    }
    console.log(chalk.yellow(`Unknown template: ${template}. Please select from the list.`));
  }

  const { selectedTemplate } = await inquirer.prompt<{ selectedTemplate: TemplateType }>([
    {
      type: 'list',
      name: 'selectedTemplate',
      message: 'Which template would you like to use?',
      choices: Object.values(TEMPLATES).map((t) => ({
        name: `${t.name} ${chalk.gray(`- ${t.description}`)}`,
        value: t.value,
      })),
    },
  ]);

  return selectedTemplate;
}

/**
 * Exclude monorepo-only artifacts from copied templates.
 */
function shouldIncludeTemplatePath(relativePath: string): boolean {
  if (!relativePath || relativePath === '.') {
    return true;
  }

  return relativePath
    .split(path.sep)
    .every((segment) => segment && !EXCLUDED_TEMPLATE_PATH_PARTS.has(segment));
}

/**
 * Resolve the absolute path to a template
 */
function resolveTemplatePath(template: TemplateType): string {
  const templateFolder = TEMPLATES[template].folder;

  // 1. Bundled into the published package at build time.
  const bundledPath = path.join(__dirname, 'templates', templateFolder);
  if (fs.pathExistsSync(bundledPath)) {
    return bundledPath;
  }

  // 2. From monorepo root (when running via pnpm)
  const monorepoRoot = findMonorepoRoot(process.cwd());
  if (monorepoRoot) {
    const templatesPath = path.join(monorepoRoot, 'templates', templateFolder);
    if (fs.pathExistsSync(templatesPath)) {
      return templatesPath;
    }
  }

  // 3. Relative to current working directory
  const cwdPath = path.join(process.cwd(), 'templates', templateFolder);
  if (fs.pathExistsSync(cwdPath)) {
    return cwdPath;
  }

  // 4. Relative to the script location (go up from packages/create-litho-app/dist)
  const scriptPath = path.resolve(__dirname, '..', '..', '..', 'templates', templateFolder);
  if (fs.pathExistsSync(scriptPath)) {
    return scriptPath;
  }

  // 5. For development - relative to src
  const devPath = path.resolve(__dirname, '..', '..', 'templates', templateFolder);
  if (fs.pathExistsSync(devPath)) {
    return devPath;
  }

  throw new Error(
    `Template "${template}" not found. Searched in:\n  - ${bundledPath}\n  - ${cwdPath}\n  - ${scriptPath}\n  - ${devPath}`
  );
}

/**
 * Find the monorepo root by looking for pnpm-workspace.yaml
 */
function findMonorepoRoot(startDir: string): string | null {
  let currentDir = startDir;

  while (currentDir !== path.dirname(currentDir)) {
    const workspaceFile = path.join(currentDir, 'pnpm-workspace.yaml');
    if (fs.pathExistsSync(workspaceFile)) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }

  return null;
}
