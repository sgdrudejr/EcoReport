#!/usr/bin/env node
// 수집한 PDF 리포트를 전문 텍스트 파일로 저장하고 OCR fallback 및 text-manifest를 생성합니다.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

import pdfParse from 'pdf-parse';

const execFile = promisify(execFileCallback);

const PREVIEW_TEXT_LIMIT = 12_000;
const DEFAULT_OCR_TRIGGER_LENGTH = 400;
const OCR_LANGUAGES = 'kor+eng';
const OCR_PSM = '6';
const OCR_DPI = 220;
const EXEC_MAX_BUFFER = 128 * 1024 * 1024;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeCliDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`--date 형식이 잘못되었습니다: ${value} (예: 2026-04-03)`);
  }

  return value;
}

function parseArgs(argv) {
  const args = {
    date: todayIso(),
    force: false,
    ocrThreshold: DEFAULT_OCR_TRIGGER_LENGTH,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--date' && argv[index + 1]) {
      args.date = normalizeCliDate(argv[index + 1]);
      index += 1;
      continue;
    }

    if (token === '--ocr-threshold' && argv[index + 1]) {
      const value = Number.parseInt(argv[index + 1], 10);
      if (Number.isFinite(value) && value >= 0) {
        args.ocrThreshold = value;
      }
      index += 1;
      continue;
    }

    if (token === '--force') {
      args.force = true;
    }
  }

  return args;
}

function normalizeText(value) {
  return (value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function commandPath(command) {
  try {
    const { stdout } = await execFile('which', [command], { maxBuffer: EXEC_MAX_BUFFER });
    const resolved = stdout.trim();
    return resolved || null;
  } catch {
    return null;
  }
}

async function ensureDirectory(targetPath) {
  await fs.mkdir(targetPath, { recursive: true });
}

async function readJson(jsonPath) {
  return JSON.parse(await fs.readFile(jsonPath, 'utf8'));
}

async function writeJson(jsonPath, value) {
  await fs.writeFile(jsonPath, JSON.stringify(value, null, 2), 'utf8');
}

async function getPageCount(pdfPath, commands) {
  if (commands.pdfinfo) {
    try {
      const { stdout } = await execFile(commands.pdfinfo, [pdfPath], { maxBuffer: EXEC_MAX_BUFFER });
      const match = stdout.match(/^Pages:\s+(\d+)/m);
      if (match) {
        return Number.parseInt(match[1], 10);
      }
    } catch {
      // ignore and fall back
    }
  }

  try {
    const buffer = await fs.readFile(pdfPath);
    const parsed = await pdfParse(buffer);
    return Number.isFinite(parsed.numpages) ? parsed.numpages : null;
  } catch {
    return null;
  }
}

async function extractWithPdftotext(pdfPath, commands) {
  if (!commands.pdftotext) {
    return null;
  }

  try {
    const { stdout } = await execFile(commands.pdftotext, ['-layout', '-nopgbrk', pdfPath, '-'], {
      maxBuffer: EXEC_MAX_BUFFER,
    });

    const text = normalizeText(stdout);
    return {
      method: 'pdftotext',
      text,
      length: text.length,
      warnings: text.length === 0 ? ['pdftotext output was empty'] : [],
    };
  } catch (error) {
    return {
      method: 'pdftotext',
      text: '',
      length: 0,
      warnings: [error instanceof Error ? error.message : String(error)],
    };
  }
}

async function extractWithPdfParse(pdfPath) {
  try {
    const buffer = await fs.readFile(pdfPath);
    const parsed = await pdfParse(buffer);
    const text = normalizeText(parsed.text);
    return {
      method: 'pdf-parse',
      text,
      length: text.length,
      warnings: text.length === 0 ? ['pdf-parse output was empty'] : [],
    };
  } catch (error) {
    return {
      method: 'pdf-parse',
      text: '',
      length: 0,
      warnings: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function bestPrimaryExtraction(candidates) {
  return [...candidates].sort((left, right) => right.length - left.length)[0] ?? null;
}

async function ocrWithPdftoppm(pdfPath, commands) {
  if (!commands.pdftoppm || !commands.tesseract) {
    return null;
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ecoreport-ocr-'));
  const prefix = path.join(tempDir, 'page');

  try {
    await execFile(commands.pdftoppm, ['-r', String(OCR_DPI), '-png', pdfPath, prefix], {
      maxBuffer: EXEC_MAX_BUFFER,
    });

    const imagePaths = (await fs.readdir(tempDir))
      .filter((fileName) => fileName.startsWith('page-') && fileName.endsWith('.png'))
      .sort((left, right) => left.localeCompare(right, 'en'));

    if (imagePaths.length === 0) {
      return {
        method: 'ocr-pdftoppm+tesseract',
        text: '',
        length: 0,
        pageCount: 0,
        warnings: ['pdftoppm produced no page images'],
      };
    }

    const pageTexts = [];
    const warnings = [];

    for (let index = 0; index < imagePaths.length; index += 1) {
      const imagePath = path.join(tempDir, imagePaths[index]);

      try {
        const { stdout } = await execFile(
          commands.tesseract,
          [imagePath, 'stdout', '-l', OCR_LANGUAGES, '--psm', OCR_PSM],
          { maxBuffer: EXEC_MAX_BUFFER },
        );

        const pageText = normalizeText(stdout);
        if (pageText) {
          pageTexts.push(`[PAGE ${index + 1}]\n${pageText}`);
        }
      } catch (error) {
        warnings.push(`page ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const text = normalizeText(pageTexts.join('\n\n'));
    return {
      method: 'ocr-pdftoppm+tesseract',
      text,
      length: text.length,
      pageCount: imagePaths.length,
      warnings,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function ocrWithSipsFirstPage(pdfPath, commands) {
  if (!commands.sips || !commands.tesseract) {
    return null;
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ecoreport-sips-'));
  const imagePath = path.join(tempDir, 'first-page.png');

  try {
    await execFile(commands.sips, ['-s', 'format', 'png', pdfPath, '--out', imagePath], {
      maxBuffer: EXEC_MAX_BUFFER,
    });

    const { stdout } = await execFile(
      commands.tesseract,
      [imagePath, 'stdout', '-l', OCR_LANGUAGES, '--psm', OCR_PSM],
      { maxBuffer: EXEC_MAX_BUFFER },
    );

    const text = normalizeText(stdout);
    return {
      method: 'ocr-sips-first-page+tesseract',
      text,
      length: text.length,
      pageCount: 1,
      warnings: ['only the first PDF page was OCR processed'],
    };
  } catch (error) {
    return {
      method: 'ocr-sips-first-page+tesseract',
      text: '',
      length: 0,
      pageCount: 1,
      warnings: [error instanceof Error ? error.message : String(error)],
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function toRelative(rootDir, absolutePath) {
  return path.relative(rootDir, absolutePath).split(path.sep).join('/');
}

function buildManifestMarkdown(manifest) {
  const lines = [
    `# ${manifest.date} 텍스트 추출 매니페스트`,
    '',
    `- 생성 시각: ${manifest.generated_at}`,
    `- 전체 리포트 수: ${manifest.total_reports}`,
    `- 성공: ${manifest.success_count}`,
    `- OCR 사용: ${manifest.ocr_used_count}`,
    `- 실패: ${manifest.failed_count}`,
    '',
    '## 사용 환경',
    `- pdftotext: ${manifest.command_availability.pdftotext ?? '미설치'}`,
    `- pdftoppm: ${manifest.command_availability.pdftoppm ?? '미설치'}`,
    `- pdfinfo: ${manifest.command_availability.pdfinfo ?? '미설치'}`,
    `- tesseract: ${manifest.command_availability.tesseract ?? '미설치'}`,
    `- sips: ${manifest.command_availability.sips ?? '미설치'}`,
    '',
    '## 추출 메서드별 건수',
    ...Object.entries(manifest.method_counts).map(([key, value]) => `- ${key}: ${value}건`),
    '',
    '## OCR 사용 리포트',
  ];

  if (manifest.entries.some((entry) => entry.ocr_used)) {
    lines.push(
      ...manifest.entries
        .filter((entry) => entry.ocr_used)
        .map(
          (entry) =>
            `- ${entry.id} / ${entry.title} / ${entry.final_method} / ${entry.final_text_length.toLocaleString('ko-KR')}자`,
        ),
    );
  } else {
    lines.push('- 없음');
  }

  lines.push('', '## 실패/경고');

  const warnings = manifest.entries.filter((entry) => entry.status !== 'ok' || entry.warnings.length > 0);
  if (warnings.length > 0) {
    lines.push(
      ...warnings.map((entry) => {
        const warningText = entry.warnings.join(' | ') || '없음';
        return `- ${entry.id} / ${entry.title} / status=${entry.status} / ${warningText}`;
      }),
    );
  } else {
    lines.push('- 없음');
  }

  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = process.cwd();
  const reportDir = path.join(rootDir, 'data', 'reports', args.date);
  const indexPath = path.join(reportDir, 'index.json');
  const textDir = path.join(reportDir, 'text');
  const manifestJsonPath = path.join(reportDir, 'text-manifest.json');
  const manifestMdPath = path.join(reportDir, 'text-manifest.md');

  const commands = {
    pdftotext: await commandPath('pdftotext'),
    pdftoppm: await commandPath('pdftoppm'),
    pdfinfo: await commandPath('pdfinfo'),
    tesseract: await commandPath('tesseract'),
    sips: await commandPath('sips'),
  };

  await fs.access(indexPath);
  await ensureDirectory(textDir);

  const indexEntries = await readJson(indexPath);
  const manifestEntries = [];

  for (const entry of indexEntries) {
    const pdfAbsolutePath = path.join(rootDir, entry.pdf_path);
    const textAbsolutePath = path.join(textDir, `${entry.id}.txt`);
    const methodsTried = [];
    const warnings = [];

    const primaryCandidates = [];
    const pdftotextResult = await extractWithPdftotext(pdfAbsolutePath, commands);
    if (pdftotextResult) {
      methodsTried.push(pdftotextResult.method);
      warnings.push(...pdftotextResult.warnings);
      primaryCandidates.push(pdftotextResult);
    }

    const pdfParseResult = await extractWithPdfParse(pdfAbsolutePath);
    methodsTried.push(pdfParseResult.method);
    warnings.push(...pdfParseResult.warnings);
    primaryCandidates.push(pdfParseResult);

    const primaryResult = bestPrimaryExtraction(primaryCandidates) ?? {
      method: 'none',
      text: '',
      length: 0,
      warnings: ['no primary extraction result'],
    };

    let finalResult = primaryResult;
    let ocrUsed = false;

    if (primaryResult.length < args.ocrThreshold) {
      let ocrResult = await ocrWithPdftoppm(pdfAbsolutePath, commands);
      if (!ocrResult || ocrResult.length === 0) {
        ocrResult = await ocrWithSipsFirstPage(pdfAbsolutePath, commands);
      }

      if (ocrResult) {
        methodsTried.push(ocrResult.method);
        warnings.push(...ocrResult.warnings);
        if (ocrResult.length > finalResult.length) {
          finalResult = ocrResult;
          ocrUsed = true;
        }
      }
    }

    const pageCount = await getPageCount(pdfAbsolutePath, commands);
    const status = finalResult.length > 0 ? 'ok' : 'empty';

    if (status === 'ok' || args.force) {
      await fs.writeFile(textAbsolutePath, `${finalResult.text}\n`, 'utf8');
    }

    entry.extracted_text = finalResult.text.slice(0, PREVIEW_TEXT_LIMIT);
    entry.text_length = finalResult.length;
    entry.full_text_path = toRelative(rootDir, textAbsolutePath);
    entry.full_text_length = finalResult.length;
    entry.text_extraction_method = finalResult.method;
    entry.ocr_used = ocrUsed;

    manifestEntries.push({
      id: entry.id,
      title: entry.title,
      category: entry.category,
      broker: entry.broker,
      source: entry.source ?? '알 수 없음',
      pdf_path: entry.pdf_path,
      text_path: entry.full_text_path,
      page_count: pageCount,
      status,
      methods_tried: methodsTried,
      primary_method: primaryResult.method,
      final_method: finalResult.method,
      primary_text_length: primaryResult.length,
      final_text_length: finalResult.length,
      ocr_used: ocrUsed,
      warnings: Array.from(new Set(warnings.filter(Boolean))),
    });
  }

  await writeJson(indexPath, indexEntries);

  const methodCounts = {};
  let successCount = 0;
  let failedCount = 0;
  let ocrUsedCount = 0;

  for (const entry of manifestEntries) {
    methodCounts[entry.final_method] = (methodCounts[entry.final_method] ?? 0) + 1;
    if (entry.status === 'ok') {
      successCount += 1;
    } else {
      failedCount += 1;
    }
    if (entry.ocr_used) {
      ocrUsedCount += 1;
    }
  }

  const manifest = {
    date: args.date,
    generated_at: new Date().toISOString(),
    total_reports: manifestEntries.length,
    success_count: successCount,
    failed_count: failedCount,
    ocr_used_count: ocrUsedCount,
    ocr_trigger_length: args.ocrThreshold,
    preview_text_limit: PREVIEW_TEXT_LIMIT,
    command_availability: commands,
    method_counts: methodCounts,
    entries: manifestEntries,
  };

  await writeJson(manifestJsonPath, manifest);
  await fs.writeFile(manifestMdPath, buildManifestMarkdown(manifest), 'utf8');

  console.log(`✅ 전문 텍스트 저장 완료: ${successCount}/${manifestEntries.length}`);
  console.log(`📝 text-manifest: ${manifestJsonPath}`);
}

main().catch((error) => {
  console.error(`❌ dump-report-texts 실패: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
