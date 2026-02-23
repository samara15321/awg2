const axios = require('axios');

const version = process.argv[2];
if (!version) {
  console.error('Version argument is required');
  process.exit(1);
}

// Зеркала релизов ImmortalWRT
const MIRRORS = [
  `https://mirrors.sjtug.sjtu.edu.cn/immortalwrt/releases/${version}/targets/`,
  `https://mirror.nju.edu.cn/immortalwrt/releases/${version}/targets/`,
  `https://mirrors.pku.edu.cn/immortalwrt/releases/${version}/targets/`
];

// Top-level targets (фиксированные)
const TOP_TARGETS = [
  'ramips', 'rockchip', 'x86', 'mediatek', 'bcm27xx', 'brcm2708',
  'sunxi', 'mvebu', 'imx6', 'lantiq', 'ath79', 'oxnas', 'ar71xx', 'malta'
];

// Ручные архитектуры для Malta
const maltaMap = {
  'be': ['mipsel_24kc', 'mips_24kc'],
  'le': ['mipsel_24kc'],
  'be64': ['mips64el_octeonplus', 'mips64_mips64r2'],
  'le64': ['mips64el_octeonplus', 'mips64_mips64r2']
};

let baseUrl = null;

// --- Найти рабочее зеркало ---
async function findWorkingMirror() {
  for (const mirror of MIRRORS) {
    try {
      await axios.head(mirror, { timeout: 10000 });
      baseUrl = mirror;
      return;
    } catch {}
  }
  console.error("No working base URL found.");
  process.exit(1);
}

// --- Получить список subtargets из profiles.json ---
async function getSubtargets(target) {
  try {
    const url = `${baseUrl}${target}/profiles.json`;
    const { data } = await axios.get(url, { timeout: 10000 });
    return Object.keys(data);
  } catch {
    return [];
  }
}

// --- Получить архитектуры для target/subtarget ---
async function getArch(target, subtarget) {
  if (target === 'malta') {
    return maltaMap[subtarget] || ['unknown'];
  }

  try {
    const url = `${baseUrl}${target}/${subtarget}/profiles.json`;
    const { data } = await axios.get(url, { timeout: 10000 });
    if (data && data.arch_packages) {
      return Array.isArray(data.arch_packages) ? data.arch_packages : [data.arch_packages];
    }
  } catch {
    return ['unknown'];
  }
}

// --- Основная функция ---
(async () => {
  await findWorkingMirror();
  console.log('Using base URL:', baseUrl);

  const matrix = [];
  const seen = new Set();

  for (const target of TOP_TARGETS) {
    const subtargets = await getSubtargets(target);
    for (const subtarget of subtargets) {
      const archs = await getArch(target, subtarget);
      for (const arch of archs) {
        const key = `${target}|${subtarget}|${arch}`;
        if (!seen.has(key)) {
          seen.add(key);
          matrix.push({ target, subtarget, pkgarch: arch });
        }
      }
    }
  }

  if (!matrix.length) {
    console.error("No architectures found for any target/subtarget.");
    process.exit(1);
  }

  // Вывод в GitHub Actions-friendly формате
  console.log(JSON.stringify({ include: matrix }));
})();
