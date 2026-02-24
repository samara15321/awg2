const axios = require('axios');

const version = process.argv[2];

if (!version) {
  console.error('Version argument is required');
  process.exit(1);
}

const baseUrl = `https://mirrors.geekpie.club/immortalwrt/releases/${version}`;
const targetsUrl = `${baseUrl}/.targets.json`;

// --- fetch JSON ---
async function fetchJSON(url) {
  const { data } = await axios.get(url, {
    timeout: 30000,
    headers: {
      'User-Agent': 'awg-builder'
    }
  });
  return data;
}

// --- main ---
async function main() {
  try {
    const json = await fetchJSON(targetsUrl);

    if (!json || typeof json !== 'object') {
      throw new Error('Invalid .targets.json format');
    }

    const matrix = [];

    for (const [key, pkgarch] of Object.entries(json)) {
      const parts = key.split('/');

      if (parts.length !== 2) {
        console.warn(`Skipping invalid entry: ${key}`);
        continue;
      }

      const [target, subtarget] = parts;

      matrix.push({
        target,
        subtarget,
        pkgarch
      });
    }

    // GitHub Actions matrix output
    console.log(JSON.stringify({ include: matrix }));

  } catch (err) {
    console.error('Error:', err.message || err);
    process.exit(1);
  }
}

main();
