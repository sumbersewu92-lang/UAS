import type { OptionKey } from '../types';

export interface ParsedBulkQuestion {
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: OptionKey;
  points: number;
}

export const CSV_TEMPLATE = [
  'pertanyaan,opsi_a,opsi_b,opsi_c,opsi_d,kunci,poin',
  '"Hasil dari 2x + 5 = 15, maka nilai x adalah...",3,4,5,6,C,10',
  '"Ibu kota negara Indonesia yang baru bernama...",Bandung,Nusantara,Surabaya,Makassar,B,10',
].join('\n');

export const BLOCK_TEMPLATE = `1. Hasil dari 2x + 5 = 15, maka nilai x adalah...
A. 3
B. 4
C. 5
D. 6
Kunci: C
Poin: 10

2. Sinonim dari kata "akselerasi" adalah...
A. Perlambatan
B. Percepatan
C. Pengurangan
D. Penghentian
Kunci: B
Poin: 10`;

function parseCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export function parseCsvQuestions(rawText: string): { items: ParsedBulkQuestion[]; errors: string[] } {
  const lines = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { items: [], errors: ['Teks CSV kosong.'] };
  }

  const delimiter = lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  const items: ParsedBulkQuestion[] = [];
  const errors: string[] = [];

  lines.forEach((line, idx) => {
    const cols = parseCsvLine(line, delimiter);
    // Skip header row
    if (idx === 0 && cols[0].toLowerCase().includes('pertanyaan')) {
      return;
    }
    if (cols.length < 6) {
      errors.push(`Baris ${idx + 1}: kolom kurang dari 6 (butuh pertanyaan, A, B, C, D, kunci).`);
      return;
    }
    const [q, a, b, c, d, keyRaw, ptsRaw] = cols;
    const key = keyRaw.trim().toUpperCase();
    if (!q || !a || !b || !c || !d) {
      errors.push(`Baris ${idx + 1}: pertanyaan atau opsi ada yang kosong.`);
      return;
    }
    if (key !== 'A' && key !== 'B' && key !== 'C' && key !== 'D') {
      errors.push(`Baris ${idx + 1}: kunci "${keyRaw}" harus A, B, C, atau D.`);
      return;
    }
    const pts = ptsRaw ? Number(ptsRaw) : 1;
    items.push({
      question_text: q,
      option_a: a,
      option_b: b,
      option_c: c,
      option_d: d,
      correct_option: key,
      points: Number.isFinite(pts) && pts > 0 ? pts : 1,
    });
  });

  return { items, errors };
}

export function parseBlockQuestions(rawText: string): { items: ParsedBulkQuestion[]; errors: string[] } {
  const blocks = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
    .split(/\n\s*\n+/)
    .map((b) => b.trim())
    .filter(Boolean);

  if (blocks.length === 0) {
    return { items: [], errors: ['Teks blok soal masih kosong.'] };
  }

  const items: ParsedBulkQuestion[] = [];
  const errors: string[] = [];

  blocks.forEach((block, index) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const questionLines: string[] = [];
    const options: Partial<Record<OptionKey, string>> = {};
    let key: OptionKey | null = null;
    let points = 1;

    for (const line of lines) {
      const optMatch = line.match(/^([A-Da-d])[.)]\s+(.+)$/);
      const keyMatch = line.match(/^(?:kunci|jawaban)\s*[:=]\s*([A-Da-d])/i);
      const ptsMatch = line.match(/^(?:poin|bobot|skor)\s*[:=]\s*(\d+(?:\.\d+)?)/i);

      if (keyMatch) {
        key = keyMatch[1].toUpperCase() as OptionKey;
      } else if (ptsMatch) {
        const parsed = Number(ptsMatch[1]);
        if (Number.isFinite(parsed) && parsed > 0) points = parsed;
      } else if (optMatch) {
        const letter = optMatch[1].toUpperCase() as OptionKey;
        options[letter] = optMatch[2].trim();
      } else {
        questionLines.push(line.replace(/^\d+[.)]\s*/, ''));
      }
    }

    const qText = questionLines.join(' ').trim();
    if (!qText || !options.A || !options.B || !options.C || !options.D || !key) {
      errors.push(
        `Blok soal ke-${index + 1}: format belum lengkap (pastikan ada pertanyaan, opsi A–D, dan baris "Kunci: A/B/C/D").`
      );
      return;
    }

    items.push({
      question_text: qText,
      option_a: options.A,
      option_b: options.B,
      option_c: options.C,
      option_d: options.D,
      correct_option: key,
      points,
    });
  });

  return { items, errors };
}

// Compress uploaded question image on client canvas so mobile students save data
export function compressImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('File harus berupa gambar (PNG/JPG/WebP).'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Gambar tidak dapat dimuat.'));
      img.onload = () => {
        const maxWidth = 760;
        const scale = img.width > maxWidth ? maxWidth / img.width : 1;
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas tidak didukung browser ini.'));
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);

        let dataUrl = canvas.toDataURL('image/webp', 0.72);
        if (!dataUrl.startsWith('data:image/webp')) {
          dataUrl = canvas.toDataURL('image/jpeg', 0.72);
        }
        if (dataUrl.length > 340000) {
          dataUrl = canvas.toDataURL('image/jpeg', 0.52);
        }
        if (dataUrl.length > 340000) {
          reject(new Error('Ukuran gambar masih terlalu besar setelah kompresi. Pilih gambar yang lebih sederhana.'));
          return;
        }
        resolve(dataUrl);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export interface ParsedParticipant {
  nis: string;
  student_name: string;
  student_class: string;
  pin?: string;
}

export const PARTICIPANTS_CSV_TEMPLATE = [
  'nis,nama,kelas,pin',
  '20260106,Budi Santoso,XI IPA 1,482915',
  '20260107,Citra Dewi Lestari,XI IPA 1,',
  '20260108,Fajar Nugroho,XI IPA 2,',
].join('\n');

export function parseParticipantsInput(rawText: string): {
  items: ParsedParticipant[];
  errors: string[];
} {
  const lines = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { items: [], errors: [] };
  }

  // Detect Excel copy-paste (tab), semicolon CSV, or comma CSV
  const sample = lines[0];
  const delimiter = sample.includes('\t')
    ? '\t'
    : sample.includes(';') && !sample.includes(',')
    ? ';'
    : ',';

  const items: ParsedParticipant[] = [];
  const errors: string[] = [];
  const seenNis = new Set<string>();

  lines.forEach((line, idx) => {
    const cols = parseCsvLine(line, delimiter);
    const firstCol = (cols[0] || '').toLowerCase();
    const secondCol = (cols[1] || '').toLowerCase();
    if (
      idx === 0 &&
      (firstCol.includes('nis') || firstCol.includes('nomor')) &&
      (secondCol.includes('nama') || secondCol.includes('siswa'))
    ) {
      return;
    }

    if (cols.length < 3) {
      errors.push(`Baris ${idx + 1}: butuh minimal 3 kolom (NIS, Nama, Kelas, dan opsional PIN).`);
      return;
    }

    const nis = cols[0].trim().toUpperCase();
    const student_name = cols[1].trim();
    const student_class = cols[2].trim();
    const rawPin = (cols[3] || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

    if (!nis || !student_name || !student_class) {
      errors.push(`Baris ${idx + 1}: kolom NIS, Nama, atau Kelas masih kosong.`);
      return;
    }

    if (nis.length > 40 || student_name.length > 100 || student_class.length > 40) {
      errors.push(`Baris ${idx + 1}: panjang teks NIS/Nama/Kelas terlalu panjang.`);
      return;
    }

    if (rawPin && (rawPin.length < 4 || rawPin.length > 16)) {
      errors.push(`Baris ${idx + 1}: PIN "${rawPin}" harus 4–16 karakter huruf/angka (atau kosongkan agar otomatis).`);
      return;
    }

    if (seenNis.has(nis)) {
      errors.push(`Baris ${idx + 1}: NIS "${nis}" duplikat di daftar impor.`);
      return;
    }

    seenNis.add(nis);
    items.push({
      nis,
      student_name,
      student_class,
      pin: rawPin || undefined,
    });
  });

  return { items, errors };
}

