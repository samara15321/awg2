const axios = require('axios');
const cheerio = require('cheerio');

const version = process.argv[2];
if (!version) {
  console.error('Version argument is required');
  process.exit(1);
}

const isSnapshot = version.endsWith('SNAPSHOT');

// Массив базовых URL для релизов и snapshot
const BASE_URLS = isSnapshot
  ? [
      // releases/<version>-SNAPSHOT
      `https://immortalwrt.kyarucloud.moe/releases/${version}/targets/`,
      `https://downloads.immortalwrt.org/releases/${version}/targets/`,
      `https://mirrors.sjtug.sjtu.edu.cn/immortalwrt/releases/${version}/targets/`,
      // snapshots/targets
      'https://immortalwrt.kyarucloud.moe/snapshots/targets/',
      'https://downloads.immortalwrt.org/snapshots/targets/',
      'https://mirrors.sjtug.sjtu.edu.cn/immortalwrt/snapshots/targets/',
    ]
  : [
      // обычные релизы
      `https://immortalwrt.kyarucloud.moe/releases/${version}/targets/`,
      `https://downloads.immortalwrt.org/releases/${version}/targets/`,
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

// Пробуем все базовые URL, пока не получится
async function tryAllBases(fn) {
  for (const baseUrl of BASE_URLS) {
    try {
      return await fn(baseUrl);
    } catch (err) {
      // console.warn(`Mirror failed: ${baseUrl}`);
      continue; // пробуем следующий
    }
  }
  throw new Error('All mirrors failed');
}

// Получаем список targets
async function getTargets() {
  return tryAllBases(async (baseUrl) => {
    const $ = await fetchHTML(baseUrl);
    const list = $('table tr td.n a')
      .map((i, el) => $(el).attr('href'))
      .get()
      .filter(href => href && href.endsWith('/'))
      .map(href => href.slice(0, -1));
    if (!list.length) throw new Error('No targets found');
    return list;
  });
}

// Получаем список subtargets
async function getSubtargets(target) {
  return tryAllBases(async (baseUrl) => {
    const $ = await fetchHTML(`${baseUrl}${target}/`);
    const list = $('table tr td.n a')
      .map((i, el) => $(el).attr('href'))
      .get()
      .filter(href => href && href.endsWith('/'))
      .map(href => href.slice(0, -1));
    if (!list.length) throw new Error('No subtargets found');
    return list;
  });
}

// Получаем pkgarch
async function getPkgarch(target, subtarget) {
  if (target === 'malta') {
    if (subtarget === 'be' || subtarget === 'le') return 'mipsel_24kc';
    if (subtarget === 'be64' || subtarget === 'le64') return 'mips64el_octeonplus';
  }

  try {
    return await tryAllBases(async (baseUrl) => {
      const json = await fetchJSON(`${baseUrl}${target}/${subtarget}/profiles.json`);
      if (json && json.arch_packages) return json.arch_packages;
      throw new Error('No arch_packages');
    });
  } catch {
    return await getPkgarchFallback(target, subtarget);
  }
}

// Фоллбек через парсинг packages/
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

    if (pkgarch === 'unknown') throw new Error('pkgarch not found');
    return pkgarch;
  });

  return pkgarch;
}

// Основная функция
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
