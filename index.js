const axios = require('axios');
const cheerio = require('cheerio');

const version = process.argv[2];
if (!version) {
  console.error('Version argument is required');
  process.exit(1);
}

// Зеркала для релизов ImmortalWRT
const BASE_URLS = [
  `https://mirrors.sjtug.sjtu.edu.cn/immortalwrt/releases/${version}/targets/`,
  `https://mirror.nju.edu.cn/immortalwrt/releases/${version}/targets/`,
  `https://mirrors.pku.edu.cn/immortalwrt/releases/${version}/targets/`
];

let baseUrl = null;

// --- Ищем рабочее зеркало ---
async function findWorkingBase() {
  for (const url of BASE_URLS) {
    try {
      const $ = await fetchHTML(url);
      if ($) {
        baseUrl = url;
        return;
      }
    } catch (err) {
      // console.error(`Failed ${url}: ${err.message}`);
      continue;
    }
  }
  console.error("No working base URL found.");
  process.exit(1);
}

// --- Фетч HTML с таймаутом и User-Agent ---
async function fetchHTML(url) {
  const { data } = await axios.get(url, {
    timeout: 20000,
    headers: { 'User-Agent': 'Mozilla/5.0' },
    maxRedirects: 5
  });
  return cheerio.load(data);
}

// --- Фетч JSON ---
async function fetchJSON(url) {
  const { data } = await axios.get(url, {
    timeout: 20000,
    headers: { 'User-Agent': 'Mozilla/5.0' },
    maxRedirects: 5
  });
  return data;
}

// --- Парсим ссылки <a href="…/"> ---
function parseLinks($) {
  return $('a')
    .map((i, el) => $(el).attr('href'))
    .get()
    .filter(href => href && href.endsWith('/'))
    .map(href => href.replace(/\/$/, ''));
}

// --- Получаем все targets ---
async function getTargets() {
  const $ = await fetchHTML(baseUrl);
  return parseLinks($);
}

// --- Получаем все subtargets ---
async function getSubtargets(target) {
  const $ = await fetchHTML(`${baseUrl}${target}/`);
  return parseLinks($);
}

// --- Ручные архитектуры Malta ---
const maltaMap = {
  'be': ['mipsel_24kc', 'mips_24kc'],
  'le': ['mipsel_24kc'],
  'be64': ['mips64el_octeonplus', 'mips64_mips64r2'],
  'le64': ['mips64el_octeonplus', 'mips64_mips64r2']
};

// --- Получаем arch для target/subtarget ---
async function getPkgarch(target, subtarget) {
  if (target === 'malta') return maltaMap[subtarget] || ['unknown'];

  const profilesUrl = `${baseUrl}${target}/${subtarget}/profiles.json`;
  try {
    const json = await fetchJSON(profilesUrl);
    if (json && json.arch_packages) {
      return Array.isArray(json.arch_packages) ? json.arch_packages : [json.arch_packages];
    }
  } catch {
    // fallback
  }

  return [await getPkgarchFallback(target, subtarget)];
}

// --- fallback для старых релизов (.ipk) ---
async function getPkgarchFallback(target, subtarget) {
  const packagesUrl = `${baseUrl}${target}/${subtarget}/packages/`;
  let pkgarch = 'unknown';
  try {
    const $ = await fetchHTML(packagesUrl);

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
        if (name && name.startsWith('kernel_')) {
          const match = name.match(/_([a-zA-Z0-9_-]+)\.ipk$/);
          if (match) {
            pkgarch = match[1];
            return false;
          }
        }
      });
    }
  } catch {}
  return pkgarch;
}

// --- Основная функция ---
async function main() {
  await findWorkingBase();
  console.log('Using base URL:', baseUrl);

  const targets = await getTargets();
  if (!targets.length) {
    console.error("No targets found on base URL.");
    process.exit(1);
  }

  const matrix = [];
  const seen = new Set();

  for (const target of targets) {
    const subtargets = await getSubtargets(target);
    for (const subtarget of subtargets) {
      const archs = await getPkgarch(target, subtarget);
      for (const pkgarch of archs) {
        const key = `${target}|${subtarget}|${pkgarch}`;
        if (!seen.has(key)) {
          seen.add(key);
          matrix.push({ target, subtarget, pkgarch });
        }
      }
    }
  }

  if (!matrix.length) {
    console.error("No architectures found for any target/subtarget.");
    process.exit(1);
  }

  console.log(JSON.stringify({ include: matrix }));
}

main();
