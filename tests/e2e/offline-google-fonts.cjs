// Synthetic HTTP/security builds only. Never imported by the application.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { once } = require('node:events');
const { readFileSync, mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

async function createOfflineGoogleFonts() {
  assert.equal(require('next/package.json').version, '16.3.3');
  // Reuse a real WOFF2 already shipped by locked Next.js: no new dependency,
  // downloaded fixture, fake font bytes or production typography change.
  const font = readFileSync(require.resolve('next/dist/next-devtools/server/font/geist-latin-ext.woff2'));
  assert.equal(createHash('sha256').update(font).digest('hex'),
    'f7604a53a00250f66db4b47dd44327ce2a43f6edec850d5217bb80238819efdd');
  let requests = 0;
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/synthetic.woff2') {
      res.writeHead(404); res.end(); return;
    }
    requests++;
    res.writeHead(200, { 'Content-Type': 'font/woff2', 'Content-Length': font.length });
    res.end(font);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const fontUrl = `http://127.0.0.1:${server.address().port}/synthetic.woff2`;
  const face = (family, weight) => `/* latin-ext */
@font-face {
  font-family: '${family}';
  font-style: normal;
  font-weight: ${weight};
  font-display: swap;
  src: url(${fontUrl}) format('woff2');
}`;
  // Exact layout requests only: a new family/weight fails rather than reaching
  // Google. Turbopack mocks CSS but still fetches each url(), hence this local
  // binary server. These fixtures exercise auth/cookies, not font appearance.
  const responses = {
    'https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap': face('Inter', '100 900'),
    'https://fonts.googleapis.com/css2?family=Poppins:wght@600;700;800;900&display=swap':
      [600, 700, 800, 900].map(weight => face('Poppins', weight)).join('\n'),
  };
  const directory = mkdtempSync(path.join(os.tmpdir(), 'yerel-siparis-offline-fonts-'));
  const responsesPath = path.join(directory, 'responses.cjs');
  writeFileSync(responsesPath, `module.exports = ${JSON.stringify(responses)};\n`);
  return {
    responsesPath,
    assertFetched() { assert.ok(requests > 0, 'The build must fetch real fixture font bytes over loopback'); },
    async close() {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      // Delete only the unique directory created above, on Windows as well.
      assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
      assert.ok(path.basename(directory).startsWith('yerel-siparis-offline-fonts-'));
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

module.exports = { createOfflineGoogleFonts };
