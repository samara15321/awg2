const axios = require('axios');
const cheerio = require('cheerio');

const version = process.argv[2];
if (!version) {
  console.error('Version argument is required');
  process.exit(1);
}

const BASE_URLS = [
  `https://downloads.immortalwrt.org/releases/${version}/targets/`,
  `https://mirror.nju.edu.cn/immortalwrt/releases/${version}/targets/`,
  `https://mirrors.sjtug.sjtu.edu.cn/immortalwrt/releases/${version}/targets/`,
];

async function fetchHTML(url) {
  const { data } = await axios.get(url, { timeout: 10000 });
  return cheerio.load(data);
}

async function fetchJSON(url) {
  const { data } = await axios.get(url, { timeout: 10000 });
  return data;
}

async function tryAllBases(fn) {
  for (const baseUrl of BASE_URLS) {
    try {
      return await fn(baseUrl);
    } catch (err) {
      // пробуем следующий
    }
  }
  throw new Error('All mirrors failed');
}

async function getTargets() {
  return tryAllBases(async (baseUrl) => {
    const $ = await fetchHTML(baseUrl);
    return $('table tr td.n a')
      .map((i, el) => $(el).attr('href'))
      .get()
      .filter(href => href && href.endsWith('/'))
      .map(href => href.slice(0, -1));
  });
}

async function getSubtargets(target) {
  return tryAllBases(async (baseUrl) => {
    const $ = await fetchHTML(`${baseUrl}${target}/`);
    return $('table tr td.n a')
      .map((i, el) => $(el).attr('href'))
      .get()
      .filter(href => href && href.endsWith('/'))
      .map(href => href.slice(0, -1));
  });
}

async function getPkgarch(target, subtarget) {
  // Хардкод для malta
  if (target === 'malta') {
    if (subtarget === 'be' || subtarget === 'le') {
      return 'mipsel_24kc';
    }
    if (subtarget === 'be64' || subtarget === 'le64') {
      return 'mips64el_octeonplus';
    }
  }

  try {
    return await tryAllBases(async (baseUrl) => {
      const json = await fetchJSON(`${baseUrl}${target}/${subtarget}/profiles.json`);
      if (json && json.arch_packages) {
        return json.arch_packages;
      }
      throw new Error('No arch_packages');
    });
  } catch {
    return await getPkgarchFallback(target, subtarget);
  }
}

async function getPkgarchFallback(target, subtarget) {
  let pkgarch = 'unknown';

  await tryAllBases(async (baseUrl) => {
    const $ = await fetchHTML(`${baseUrl}${target}/${subtarget}/packages/`);

    $('a').each((i, el) => {
      const name = $(el).attr('href');
      if (name && name.endsWith('.ipk') && !name.startsWith('kernel_') && !name.includes('kmod-')) {
        const match = name.match(/_([a-zA-Z0-9_-]+)\.ipk$/);
        if (match) {
          pkgarch = match[1];
          return false;
        }
      }
    });

    if (pkgarch === 'unknown') {
      $('a').each((i, el) => {
        const name = $(el).attr('href');
        if (name && name.startsWith('kernel_') && name.endsWith('.ipk')) {
          const match = name.match(/_([a-zA-Z0-9_-]+)\.ipk$/);
          if (match) {
            pkgarch = match[1];
            return false;
          }
        }
      });
    }

    if (pkgarch !== 'unknown') {
      return pkgarch;
    }

    throw new Error('Not found');
  });

  return pkgarch;
}

async function main() {
  try {
    const targets = await getTargets();
    const matrix = [];

    for (const target of targets) {
      const subtargets = await getSubtargets(target);
      for (const subtarget of subtargets) {
        const pkgarch = await getPkgarch(target, subtarget);
        matrix.push({ target, subtarget, pkgarch });
      }
    }

    console.log(JSON.stringify({ include: matrix }));
  } catch (err) {
    console.error('Error:', err.message || err);
    process.exit(1);
  }
}

main();
