// Frontend-only patch for the separately hosted status dashboard. No API changes.
const fs = require('node:fs');

const marker = '/* Lithosphere status mobile layout 2026-10-20 */';
const css = `
    ${marker}
    .metrics-grid {
      grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr));
    }
    .metric-card,
    .status-copy {
      min-width: 0;
    }
    .metric-value {
      max-width: 100%;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .metric-value--timestamp {
      font-size: clamp(1rem, 6cqi, 1.5rem);
      line-height: 1.4;
    }
    .status-detail {
      overflow-wrap: anywhere;
    }
`;

function applyMobileLayout(html) {
  if (!html.includes('<title>Lithosphere Network Status</title>')) {
    throw new Error('Expected the Lithosphere status dashboard HTML');
  }
  if (html.includes(marker)) return html;
  const timestamp = '<div class="metric-value">${escapeHtml(lastBlockLabel)}</div>';
  if (html.split(timestamp).length !== 2 || html.split('</style>').length !== 2) {
    throw new Error('Status dashboard markup changed; inspect before patching');
  }
  return html.replace(timestamp,
    '<div class="metric-value metric-value--timestamp">${escapeHtml(lastBlockLabel)}</div>')
    .replace('</style>', `${css}  </style>`);
}

module.exports = { applyMobileLayout };

if (require.main === module) {
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination) throw new Error('Usage: node mobile-layout.cjs INPUT.html OUTPUT.html');
  fs.writeFileSync(destination, applyMobileLayout(fs.readFileSync(source, 'utf8')), { flag: 'wx' });
}
