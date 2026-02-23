const axios = require('axios');

const version = process.argv[2];
if (!version) {
  console.error('Version required');
  process.exit(1);
}

const BASE_URL =
  `https://mirrors.sjtug.sjtu.edu.cn/immortalwrt/releases/${version}/targets/`;

async function fetchText(url) {
  const res = await axios.get(url, {
    timeout: 20000,
    responseType: 'text',
    headers: { 'User-Agent': 'Mozilla/5.0' },
    transformResponse: r => r // ← ВАЖНО
  });

  return typeof res.data === 'string'
    ? res.data
    : res.data.toString();
}

function parseDirs(html) {
  return [...html.matchAll(/href="([^"?]+\/)"/g)]
    .map(m => m[1].replace(/\/$/, ''))
    .filter(n =>
      n !== '../' &&
      !n.startsWith('?') &&
      !n.startsWith('/')
    );
}

async function getTargets() {
  const html = await fetchText(BASE_URL);
  return parseDirs(html);
}

async function getSubtargets(target) {
  const html = await fetchText(`${BASE_URL}${target}/`);
  return parseDirs(html);
}

async function getArch(target, subtarget) {
  const url =
    `${BASE_URL}${target}/${subtarget}/profiles.json`;

  try {
    const { data } = await axios.get(url, {
      timeout: 20000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    if (data.arch_packages)
      return Array.isArray(data.arch_packages)
        ? data.arch_packages
        : [data.arch_packages];

  } catch {}

  return ['unknown'];
}

async function main() {
  console.log("Using:", BASE_URL);

  const targets = await getTargets();

  if (!targets.length) {
    console.error("No targets found on base URL.");
    process.exit(1);
  }

  const matrix = [];
  const seen = new Set();

  for (const t of targets) {
    const subs = await getSubtargets(t);

    for (const s of subs) {
      const archs = await getArch(t, s);

      for (const a of archs) {
        const key = `${t}|${s}|${a}`;
        if (!seen.has(key)) {
          seen.add(key);
          matrix.push({
            target: t,
            subtarget: s,
            pkgarch: a
          });
        }
      }
    }
  }

  console.log(JSON.stringify({ include: matrix }));
}

main();
