const axios = require('axios');
const cheerio = require('cheerio');

const version = process.argv[2];
if (!version) {
  console.error('Version argument is required');
  process.exit(1);
}

// Список зеркал (в порядке приоритета)
const BASE_URLS = [
  `https://mirrors.sjtug.sjtu.edu.cn/immortalwrt/releases/${version}/targets/`,
  `https://mirror.nju.edu.cn/immortalwrt/releases/${version}/targets/`,
  `https://mirrors.pku.edu.cn/immortalwrt/releases/${version}/targets/`,
  `https://downloads.immortalwrt.org/releases/${version}/targets/`,
  `https://immortalwrt.kyarucloud.moe/releases/${version}/targets/`
];

let baseUrl;

// Находим рабочее зеркало
async function selectBaseUrl() {
  for (const url of BASE_URLS) {
    try {
      await axios.head(url, { timeout: 10000 }); // проверяем доступность
      baseUrl = url;
      return;
    } catch {}
  }
  throw new Error('No working base URL found.');
}

// Получение HTML с таймаутом 30 сек
async function fetchHTML(url) {
  const { data } = await axios.get(url, { timeout: 30000 });
  return cheerio.load(data);
}

// Получение JSON с таймаутом 30 сек
async function fetchJSON(url) {
  const { data } = await axios.get(url, { timeout: 30000 });
  return data;
}

// Получаем список targets
async function getTargets() {
  const $ = await fetchHTML(baseUrl);
  return $('table tr td.n a')
    .map((i, el) => $(el).attr('href'))
    .get()
    .filter(href => href && href.endsWith('/'))
    .map(href => href.slice(0, -1));
}

// Получаем список subtargets
async function getSubtargets(target) {
  const $ = await fetchHTML(`${baseUrl}${target}/`);
  return $('table tr td.n a')
    .map((i, el) => $(el).attr('href'))
    .get()
    .filter(href => href && href.endsWith('/'))
    .map(href => href.slice(0, -1));
}

// Определяем архитектуры
async function getPkgarch(target, subtarget) {
  // --- MANUAL MALTA ARCHS ---
  if (target === 'malta') {
    const maltaMap = {
      'be': ['mipsel_24kc', 'mips_24kc'],
      'le': ['mipsel_24kc'],
      'be64': ['mips64el_octeonplus', 'mips64_mips64r2'],
      'le64': ['mips64el_octeonplus', 'mips64_mips64r2']
    };
    return maltaMap[subtarget] || ['unknown'];
  }

  // --- Try profiles.json (newer releases, 25.x+) ---
  const profilesUrl = `${baseUrl}${target}/${subtarget}/profiles.json`;
  try {
    const json = await fetchJSON(profilesUrl);
    if (json && json.arch_packages) 
      return Array.isArray(json.arch_packages) ? json.arch_packages : [json.arch_packages];
  } catch {
    // profiles.json не найден, fallback
  }

  // --- Fallback: parse .ipk packages (старые релизы) ---
  return [await getPkgarchFallback(target, subtarget)];
}

// Парсим .ipk для определения arch
async function getPkgarchFallback(target, subtarget) {
  const packagesUrl = `${baseUrl}${target}/${subtarget}/packages/`;
  let pkgarch = 'unknown';
  try {
    const $ = await fetchHTML(packagesUrl);

    // ищем первый не-kernel .ipk (обычно правильный arch)
    $('a').each((i, el) => {
      const name = $(el).attr('href');
      if (name && name.endsWith('.ipk') && !name.startsWith('kernel_') && !name.includes('kmod-')) {
        const match = name.match(/_([a-zA-Z0-9_-]+)\.ipk$/);
        if (match) {
          pkgarch = match[1];
          return false; // break
        }
      }
    });

    // fallback: если ничего не нашли, пробуем kernel_*
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

// Главная функция
async function main() {
  try {
    await selectBaseUrl(); // выбираем рабочее зеркало

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

    // вывод для GitHub Actions в одну строку
    console.log(JSON.stringify({ include: matrix }));
  } catch (err) {
    console.error('Error:', err.message || err);
    process.exit(1);
  }
}

main();
