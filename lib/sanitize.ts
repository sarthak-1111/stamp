/**
 * Input hygiene for everything a stranger can type. React escapes on output; this removes characters
 * that are used to disguise text (zero-width, bidirectional overrides) and control characters.
 */

const HIDDEN = /[­​-‏‪-‮⁠-⁤⁦-⁩﻿]/gu;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export type Cleaned = { text: string; hadHidden: boolean };

export function cleanText(input: unknown, opts: { multiline?: boolean; max: number }): Cleaned {
  let s = typeof input === 'string' ? input : '';
  s = s.normalize('NFKC');
  const hadHidden = s.replace(HIDDEN, '') !== s;
  s = s.replace(HIDDEN, '').replace(/\r\n?/g, '\n').replace(CONTROL, '');
  if (!opts.multiline) s = s.replace(/[\n\t]+/g, ' ');
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text: s.slice(0, opts.max), hadHidden };
}
