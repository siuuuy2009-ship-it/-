import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve, sep } from 'node:path';

const base = process.env.SETUP_BASE_URL ?? 'https://dasi-nanum.vercel.app';
const directory = resolve('work/school-roster');
const operatorOnly = process.argv.includes('--operator-only');
const rosterPath = resolve(
  process.argv.slice(2).find((arg) => arg !== '--operator-only') ??
    'work/school-roster/1학년-명단.csv',
);
if (!rosterPath.startsWith(resolve('work') + sep))
  throw new Error('Use a private roster file inside work/.');
await mkdir(directory, { recursive: true });
const credentialsPath = resolve(directory, 'operator-private.json');
let saved;
try {
  saved = JSON.parse(await readFile(credentialsPath, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (saved && saved.base !== base)
  throw new Error('Existing operator belongs to a different deployment.');
async function send(body, cookie = '') {
  const response = await fetch(`${base}/api/school`, {
    method: 'POST',
    headers: {
      Origin: base,
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error ?? `Setup failed: ${response.status}`);
  return {
    data,
    cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '',
  };
}
let session;
if (saved) {
  session = await send({
    action: 'login',
    schoolCode: saved.schoolCode,
    loginId: saved.loginId,
    password: saved.password,
  });
} else {
  const password = randomBytes(24).toString('base64url');
  session = await send({
    action: 'create-school',
    title: '우리 학교 나눔 행사',
    loginId: 'admin',
    password,
  });
  saved = {
    base,
    schoolCode: session.data.user.schoolCode,
    loginId: 'admin',
    password,
  };
  await writeFile(credentialsPath, JSON.stringify(saved, null, 2), {
    mode: 0o600,
    flag: 'wx',
  });
}
const link = `${base}/?school=${saved.schoolCode}`;
await writeFile(
  resolve(directory, '운영자-로그인.txt'),
  `다시, 나눔 운영자 로그인\n\n주소: ${link}\n학교코드: ${saved.schoolCode}\n아이디: ${saved.loginId}\n비밀번호: ${saved.password}\n\n이 파일과 전체 초대코드 명단은 운영자만 보관하세요.\n학생에게는 각자의 초대코드 또는 가입 링크만 전달하세요.\n`,
  { mode: 0o600 },
);
if (operatorOnly) {
  await send({ action: 'logout' }, session.cookie);
  console.log(
    JSON.stringify({
      schoolUrl: link,
      invitedStudents: 0,
      credentialsSaved: true,
    }),
  );
  process.exit(0);
}
const roster = await readFile(rosterPath, 'utf8');
const imported = await send(
  { action: 'import-roster', roster },
  session.cookie,
);
const invitations = imported.data.invitations;
if (invitations.length) {
  const rows = [
    ['학번', '이름', '초대코드', '학교코드', '가입링크'],
    ...invitations.map((entry) => [
      entry.studentNumber,
      entry.name,
      entry.code,
      saved.schoolCode,
      `${link}#invite=${entry.code}`,
    ]),
  ];
  const csv =
    '\uFEFF' +
    rows
      .map((row) =>
        row.map((value) => `"${value.replaceAll('"', '""')}"`).join(','),
      )
      .join('\r\n');
  await writeFile(resolve(directory, '1학년-학생별초대코드.csv'), csv, {
    mode: 0o600,
    flag: 'wx',
  });
}
await send({ action: 'logout' }, session.cookie);
console.log(
  JSON.stringify({
    schoolUrl: link,
    invitedStudents: invitations.length,
    credentialsSaved: true,
  }),
);
