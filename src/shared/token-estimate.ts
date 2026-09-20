// CJK-aware token estimators.
//
// Why not chars/4: Chinese text is roughly 1 token per character on common
// providers; chars/4 underestimates CJK context size by 3-6x, which delays
// budget checks badly on Chinese-heavy sessions.
//
// These are ESTIMATES, not tokenizers: the authoritative count is always the
// provider-returned usage.prompt_tokens (shell/call.ts lastRequestTokens).
// They are used where no usage exists yet (pre-request checks, tool-result
// budgets, user-message budgets).

const isCJK = (c: number): boolean =>
  (c >= 0x4e00 && c <= 0x9fff) ||   // CJK unified ideographs
  (c >= 0x3400 && c <= 0x4dbf) ||   // CJK extension A
  (c >= 0x20000 && c <= 0x2a6df) || // CJK extension B
  (c >= 0x3000 && c <= 0x303f) ||   // CJK punctuation
  (c >= 0xff00 && c <= 0xffef) ||   // fullwidth forms
  (c >= 0x3040 && c <= 0x30ff)      // hiragana / katakana

export const estimateTokens = (text: string): number => {
  let cjk = 0
  let other = 0
  for (const ch of text) {
    if (isCJK(ch.codePointAt(0) ?? 0)) cjk++
    else other++
  }
  return cjk + Math.ceil(other / 4)
}

// Wide CJK ranges (astral extension planes + compatibility ideographs that
// common CJK tokenizers treat as single tokens).
const isCJKWide = (cp: number): boolean =>
  (cp >= 0x4e00 && cp <= 0x9fff) ||
  (cp >= 0x3400 && cp <= 0x4dbf) ||
  (cp >= 0x20000 && cp <= 0x2a6df) ||
  (cp >= 0x2a700 && cp <= 0x2b73f) ||
  (cp >= 0x2b740 && cp <= 0x2b81f) ||
  (cp >= 0x2b820 && cp <= 0x2ceaf) ||
  (cp >= 0xf900 && cp <= 0xfaff) ||
  (cp >= 0x2f800 && cp <= 0x2fa1f)

// JS \s equivalence by code point (ASCII whitespace + the Unicode spaces \s matches).
const isWhitespace = (cp: number): boolean =>
  cp === 0x20 || (cp >= 0x09 && cp <= 0x0d) || cp === 0xa0 || cp === 0x1680 ||
  (cp >= 0x2000 && cp <= 0x200a) || cp === 0x2028 || cp === 0x2029 ||
  (cp >= 0x202f && cp <= 0x205f) || cp === 0x3000 || cp === 0xfeff

/**
 * Wide-range local token estimate: CJK ≈ 0.6 token/char, a run of consecutive
 * whitespace ≈ 1 token, everything else ≈ 0.3 token/char. Deterministic and
 * computed over the exact content we are about to put on the wire.
 */
export const estimateTokensWide = (text: string): number => {
  let total = 0
  let prevSpace = false
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if (isCJKWide(cp)) {
      total += 0.6
      prevSpace = false
    } else if (isWhitespace(cp)) {
      if (!prevSpace) {
        total += 1
        prevSpace = true
      }
    } else {
      total += 0.3
      prevSpace = false
    }
  }
  return Math.max(Math.ceil(total), 1)
}
