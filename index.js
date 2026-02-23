const axios = require('axios');
const cheerio = require('cheerio');

const version = process.argv[2];
if (!version) {
  console.error('Version argument is required');
  process.exit(1);
}

// Список зеркал для релизов ImmortalWRT
const BASE_URLS = [
  `https://mirrors.sjtug.sjtu.edu.cn/immortalwrt/releases/${version}/targets/`,
  `https://mirror.nju.edu.cn/immortalwrt/releases/${version}/targets/`,
  `https://mirrors.pku.edu.cn/immortalwrt/releases/${version}/targets/`
];

let baseUrl = null;

// --- Найти рабочее зеркало ---
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

// --- Фетч HTML с таймаутом и User-Agent ---
async function fetchHTML(url) {
  const { data } = await axios.get(url, {
    timeout: 20000,
    headers: { 'User-Agent': 'Mozilla/5.0' },
    maxRedirects: 5
  });
  return data;
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

// --- Универсальный парсер директорий ---
function parseDirectoryListing(html) {
  // Находит все href="…/" и убирает ../
  return Array.from(html.matchAll(/href="([^"]+?)\/"/g))
    .map(m => m[1])
    .filter(href => href !== '../');
}

// --- Получаем все targets ---
async function getTargets() {
  const html = await fetchHTML(baseUrl);
  return parseDirectoryListing(html);
}

// --- Получаем все subtargets для target ---
async function getSubtargets(target) {
  const html = await fetchHTML(`${baseUrl}${target}/`);
  return parseDirectoryListing(html);
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
    return ['unknown'];
  }
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

  // --- Вывод для GitHub Actions ---
  console.log(JSON.stringify({ include: matrix }));
}

main();
