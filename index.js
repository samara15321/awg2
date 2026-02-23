const axios = require('axios');

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

// --- Ищем рабочее зеркало ---
async function findWorkingBase() {
  for (const url of BASE_URLS) {
    try {
      await axios.get(url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      baseUrl = url;
      return;
    } catch {}
  }
  console.error("No working base URL found.");
  process.exit(1);
}

// --- Парсер HTML директории ---
function parseDirectoryListing(html) {
  const matches = Array.from(html.matchAll(/href="([^"]+?)\/"/g));
  return matches.map(m => m[1]);
}

// --- Получаем все targets ---
async function getTargets() {
  const res = await axios.get(baseUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 });
  return parseDirectoryListing(res.data);
}

// --- Получаем subtargets ---
async function getSubtargets(target) {
  const url = `${baseUrl}${target}/`;
  const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 });
  return parseDirectoryListing(res.data);
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
    const res = await axios.get(profilesUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 });
    const json = res.data;
    if (json && json.arch_packages) {
      return Array.isArray(json.arch_packages) ? json.arch_packages : [json.arch_packages];
    }
  } catch {
    // fallback на .ipk
  }

  return ['unknown'];
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
