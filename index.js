const axios = require('axios');
const cheerio = require('cheerio');

const version = process.argv[2]; // Получение версии OpenWRT из аргумента командной строки

if (!version) {
  console.error('Version argument is required');
  process.exit(1);
}

const url = `https://downloads.immortalwrt.org/releases/${version}/targets/`;

async function fetchHTML(url) {
  try {
    const { data } = await axios.get(url);
    return cheerio.load(data);
  } catch (error) {
    console.error(`Error fetching HTML for ${url}: ${error}`);
    throw error;
  }
}

async function getTargets() {
  const $ = await fetchHTML(url);
  const targets = [];
  $('table tr td.n a').each((index, element) => {
    const name = $(element).attr('href');
    if (name && name.endsWith('/')) {
      targets.push(name.slice(0, -1));
    }
  });
  return targets;
}

async function getSubtargets(target) {
  const $ = await fetchHTML(`${url}${target}/`);
  const subtargets = [];
  $('table tr td.n a').each((index, element) => {
    const name = $(element).attr('href');
    if (name && name.endsWith('/')) {
      subtargets.push(name.slice(0, -1));
    }
  });
  return subtargets;
}

async function getDetails(target, subtarget) {
  const packagesUrl = `${url}${target}/${subtarget}/packages/`;
  const $ = await fetchHTML(packagesUrl);
  let pkgarch = '';

  $('a').each((index, element) => {
    const name = $(element).attr('href');
    if (name && name.startsWith('kernel_')) {
      const match = name.match(/kernel_\d+\.\d+\.\d+(?:-\d+)?[-~][a-f0-9]+_([a-zA-Z0-9_-]+)\.ipk$/);
      if (match) {
        pkgarch = match[1];
      }
    }
  });

  // Если не нашли pkgarch, ставим placeholder
  if (!pkgarch) pkgarch = "unknown";

  return { pkgarch };
}

async function main() {
  try {
    const targets = await getTargets();
    const matrix = [];

    for (const target of targets) {
      const subtargets = await getSubtargets(target);
      for (const subtarget of subtargets) {
        const { pkgarch } = await getDetails(target, subtarget);

        // Добавляем только поля, которые будут использоваться в matrix
        matrix.push({
          target,
          subtarget,
          pkgarch
        });
      }
    }

    // Выводим JSON в stdout одной строкой
    console.log(JSON.stringify(matrix));

  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

main();
