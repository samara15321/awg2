const axios = require('axios');
const cheerio = require('cheerio');

const version = process.argv[2];
if (!version) {
  console.error('Version argument is required');
  process.exit(1);
}

// Список зеркал для релизов
const BASE_URLS = [
  `https://mirrors.sjtug.sjtu.edu.cn/immortalwrt/releases/${version}/targets/`,
  `https://mirror.nju.edu.cn/immortalwrt/releases/${version}/targets/`,
  `https://mirrors.pku.edu.cn/immortalwrt/releases/${version}/targets/`
];

let baseUrl = null;

// Пробуем найти рабочее зеркало
async function findWorkingBase() {
  for (const url of BASE_URLS) {
    try {
      await fetchHTML(url);
      baseUrl = url;
      return;
    } catch {}
  }
  console.error("No working base URL found.");
  process.exit(1);
}

// Функции загрузки HTML и JSON
async function fetchHTML(url) {
  const { data } = await axios.get(url, { timeout: 15000 });
  return cheerio.load(data);
}

async function fetchJSON(url) {
  const { data } = await axios.get(url, { timeout: 15000 });
  return data;
}

// Универсальный парсер ссылок <a>
function parseLinks($) {
  return $('a')
    .map((i, el) => $(el).attr('href'))
    .get()
    .filter(href => href && href.endsWith('/'))
    .map(href => href.replace(/\/$/, ''));
}

// Получаем все таргеты
async function getTargets() {
  const $ = await fetchHTML(baseUrl);
  return parseLinks($);
}

// Получаем все субтаргеты
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

// Получаем архитектуры для таргета
async function getPkgarch(target, subtarget) {
  if (target === 'malta') {
    return maltaMap[subtarget] || ['unknown'];
  }

  // profiles.json для новых релизов
  const profilesUrl = `${baseUrl}${target}/${subtarget}/profiles.json`;
  try {
    const json = await fetchJSON(profilesUrl);
    if (json && json.arch_packages) {
      return Array.isArray(json.arch_packages) ? json.arch_packages : [json.arch_packages];
    }
  } catch {
    // fallback
  }

  // fallback на парсинг .ipk
  return [await getPkgarchFallback(target, subtarget)];
}

// Парсинг пакетов для старых релизов
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

// Основная функция
async function main() {
  await findWorkingBase();
  console.log('Using base URL:', baseUrl);

  const targets = await getTargets();
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

  if (matrix.length === 0) {
    console.error("No targets found on base URL.");
    process.exit(1);
  }

  // вывод в одну строку для GitHub Actions
  console.log(JSON.stringify({ include: matrix }));
}

main();
