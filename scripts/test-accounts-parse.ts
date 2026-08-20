/**
 * Parser tests for the connected-accounts flows.
 *
 * The fixtures are REAL captured output, not invented strings: the Claude one
 * is what `script -q -c "claude setup-token" /dev/null` actually printed in the
 * factory container (2.1.233), the Codex one is real `codex login --device-auth`
 * stdout. That matters because the whole reason `stripAnsi` keeps OSC-8 payloads
 * is a detail nobody would guess from the rendered text — the visible URL is
 * hard-wrapped across five lines and cursor-positioned, and only the hyperlink
 * escape carries it whole.
 */
import { readFileSync } from 'node:fs';
import { stripAnsi, extractUrl, extractDeviceCode, tidyCliReason } from '../src/api/accounts.js';

let failures = 0;

function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const OAUTH_URL =
  'https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e'
  + '&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback'
  + '&scope=user%3Ainference&code_challenge=Jp8BnDnZdLPDjx0-I5uFNVwFOUGGSPZDadmt-SKJVSM'
  + '&code_challenge_method=S256&state=-Sk4XejT11Qjp3_wiOm5D2bSIYtCHL8ZWuuelcmH1qs';

/** Two wrapped OSC-8 chunks, exactly as the PTY emits them. */
const CLAUDE_PTY =
  '\x1b7\x1b[r\x1b8\x1b[?25h\x1b[?25l\x1b[?2004h'
  + 'Welcome\x1b[9Gto\x1b[12GClaude\x1b[19GCode\x1b[24Gv2.1.233\r\r\n'
  + "\x1b[2G\xc2\xb7\x1b[4GOpening\x1b[12Gbrowser\x1b[20Gto\x1b[23Gsign\x1b[28Gin\r\r\n"
  + "Browser didn't open?\x1b[23GUse the url\x1b[35Gbelow\x1b[41Gto\x1b[44Gsign\x1b[49Gin\r\r\n"
  + `\x1b]8;id=ag8e86;${OAUTH_URL}\x07https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88\x1b]8;;\x07\r\r\n`
  + `\x1b]8;id=ag8e86;${OAUTH_URL}\x07ed-5944d1962f5e&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.co\x1b]8;;\x07\r\r\n`
  + '\x1b[2GPaste\x1b[8Gcode\x1b[13Ghere\x1b[18Gif\x1b[21Gprompted\x1b[30G>\r\r\n';

/** The rejection path, as printed after a bogus code was piped in. */
const CLAUDE_BAD_CODE =
  '\x1b(B\x0f\x1b[2K\x1b[1A\x1b[2K\x1b[1A\x1b[2K\x1b[G\x1b[1A\r\x1b[1C\x1b[4A'
  + 'OAuth error: Invalid\x1b[23Gcode. Please make\x1b[41Gsure the full\x1b[55Gc\x1b[57Gde was\x1b[64Gcopied'
  + '\r\x1b[2B\x1b[K\r\x1b[1B Press Enter to retry.\x1b[K\r\x1b[1B\x1b[K';

const CODEX_STDOUT =
  "\nWelcome to Codex [v\x1b[90m0.147.0\x1b[0m]\n"
  + "\x1b[90mOpenAI's command-line coding agent\x1b[0m\n\n"
  + 'Follow these steps to sign in with ChatGPT using device code authorization:\n\n'
  + '1. Open this link in your browser and sign in to your account\n'
  + '   \x1b[94mhttps://auth.openai.com/codex/device\x1b[0m\n\n'
  + '2. Enter this one-time code \x1b[90m(expires in 15 minutes)\x1b[0m\n'
  + '   \x1b[94mXD37-SXIBN\x1b[0m\n';

// ─── Claude ──────────────────────────────────────────────────────────────────

console.log('claude setup-token (PTY output)');
{
  const clean = stripAnsi(CLAUDE_PTY);
  check('cursor-positioning escapes are gone', !/\x1b/.test(clean));
  // The whole point of rendering by column rather than deleting escapes: Ink
  // emits `Welcome` `CSI 9 G` `to` `CSI 12 G` `Claude` … with no spaces of its
  // own, so a strip-only pass produces `Welcometo Claude`.
  check(
    'words are separated as on screen',
    clean.includes('Welcome to Claude Code v2.1.233'),
    JSON.stringify(clean.split('\n')[0]),
  );
  check('prompt line survives', clean.includes('Paste code here if prompted'));
  // ESC 7 / ESC 8 (save/restore cursor) are two-byte escapes whose second byte
  // is a DIGIT — an escape class stopping at `@-_` leaves `78` as visible text.
  check('ESC 7 / ESC 8 leave no literal digits', !clean.startsWith('78'), JSON.stringify(clean.slice(0, 12)));

  const url = extractUrl(clean, ['claude.com', 'claude.ai', 'anthropic.com']);
  check('OAuth URL extracted whole', url === OAUTH_URL, `got ${String(url).slice(0, 90)}…`);
  check('URL is not the wrapped fragment', !!url && url.includes('state=-Sk4XejT11Qjp3_wiOm5D2bSIYtCHL8ZWuuelcmH1qs'));

  // Host allowlist: an attacker-influenced string in the buffer must not become
  // "the link to log in with".
  const evil = stripAnsi('see https://evil.example/phish and nothing else');
  check('foreign host rejected', extractUrl(evil, ['claude.com']) === undefined);
}

console.log('claude bad-code rejection');
{
  const clean = stripAnsi(CLAUDE_BAD_CODE);
  const m = clean.match(/OAuth error:\s*([^\n]*)/i);
  check('OAuth error line matched', !!m);
  check('reason is readable', !!m && m[1].includes('Invalid') && m[1].includes('code'), m?.[1]);
  check('retry hint present', clean.includes('Press Enter to retry'));

  // What Roman actually reads. The raw match carries carriage returns and the
  // CLI's terminal-only "Press Enter to retry" — neither belongs in a web UI.
  const tidy = tidyCliReason(m![1]);
  check('tidied reason has no CR', !/[\r\t]/.test(tidy), JSON.stringify(tidy));
  check('tidied reason drops the terminal hint', !/Press Enter/i.test(tidy), tidy);
  check(
    'tidied reason is the sentence itself',
    tidy === 'Invalid code. Please make sure the full code was copied',
    tidy,
  );
}

console.log('claude token capture');
{
  const re = /\b(sk-ant-oat[0-9]{2}-[A-Za-z0-9._\-]{20,})\b/;
  const sample = 'Success! Your token:\n  sk-ant-oat01-AbCdEf0123456789_xyz-ABCDEFGHIJ\nKeep it secret.';
  const m = sample.match(re);
  check('token matched', !!m);
  check('token is exact', m?.[1] === 'sk-ant-oat01-AbCdEf0123456789_xyz-ABCDEFGHIJ', m?.[1]);
  check('a bare sk-ant- API key does NOT match', !/\b(sk-ant-oat[0-9]{2}-)/.test('sk-ant-api03-nope'));
}

// ─── Codex ───────────────────────────────────────────────────────────────────

console.log('codex login --device-auth (plain stdout)');
{
  const clean = stripAnsi(CODEX_STDOUT);
  check('colors stripped', !clean.includes('\x1b['));
  const url = extractUrl(clean, ['openai.com', 'chatgpt.com']);
  check('device URL extracted', url === 'https://auth.openai.com/codex/device', String(url));
  check('one-time code extracted', extractDeviceCode(clean) === 'XD37-SXIBN', String(extractDeviceCode(clean)));
}

// ─── Regression: the real thing, byte for byte ───────────────────────────────
//
// The fixtures above are hand-transcribed and therefore only as good as the
// transcription. This one is the raw PTY capture from the factory container of
// a full run — start, URL, a bogus code, rejection — saved verbatim. It carries
// no credential (the OAuth challenge in it was never completed and has long
// expired; `grep sk-ant-oat` finds nothing), so it is safe to keep in the repo,
// and it is what makes a future CLI change fail this test instead of production.

console.log('real PTY capture (scripts/fixtures/claude-setup-token-pty.b64)');
{
  const b64 = readFileSync(
    new URL('./fixtures/claude-setup-token-pty.b64', import.meta.url), 'utf8',
  ).trim();
  const raw = Buffer.from(b64, 'base64').toString('utf8');
  const clean = stripAnsi(raw);

  const url = extractUrl(clean, ['claude.com', 'claude.ai', 'anthropic.com']);
  check('OAuth URL found in real output', !!url && url.startsWith('https://claude.com/cai/oauth/authorize'), String(url).slice(0, 60));
  check('URL carries a full state param', !!url && /[?&]state=[A-Za-z0-9_-]{20,}/.test(url));
  check('URL is not truncated mid-parameter', !!url && url.includes('code_challenge_method=S256'));

  check('prompt line rendered', /Paste code here if prompted/.test(clean));

  const m = clean.match(/OAuth error:\s*([^\n]*)/i);
  check('rejection detected in real output', !!m);
  check(
    'rejection reads as a sentence',
    !!m && tidyCliReason(m[1]) === 'Invalid code. Please make sure the full code was copied',
    m ? tidyCliReason(m[1]) : undefined,
  );

  check('no token leaked into the fixture', !/sk-ant-oat/.test(raw));
}

console.log(failures === 0 ? '\nALL OK' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
