/**
 * Money for the Mission Engine: an amount in **whole BRL cents**.
 *
 * Cost accumulates across many small increments and is compared against a Cap, so a binary
 * fraction that cannot represent `0.10` is disqualified. `Money` is therefore an integer count of
 * cents, branded so a raw `number` — the result of any float arithmetic included — cannot be
 * passed where an amount is required.
 *
 * There is no float path anywhere in this module:
 *
 * - construction from cents refuses anything that is not a safe integer, loudly, instead of
 *   rounding;
 * - construction from a decimal string parses digits and never calls `parseFloat`;
 * - the formatter slices digit strings and never divides by 100.
 *
 * **Negative amounts are not representable.** Every amount in this domain is a cost or a Cap, and
 * neither is ever below zero: there are no refunds, no credits and no subtraction in the model.
 * Allowing negatives would force every Cap comparison to handle a state the domain cannot produce,
 * and would let a sign error accumulate silently instead of failing at the boundary. Consequently
 * this module exposes no subtraction — the operation that would create one. If "how much is left
 * under the Cap" is ever needed, it is a different concept (a remainder that can be exhausted) and
 * gets its own modelling rather than a negative `Money`.
 */

declare const brand: unique symbol;

/**
 * An amount in whole BRL cents.
 *
 * Assignable to `number`, so an amount can be compared and printed, but never assignable *from*
 * one: `a + b` on two amounts produces a plain `number` and has to go back through
 * `moneyFromCents`, which is where the integer check lives.
 */
export type Money = number & { readonly [brand]: "Money" };

/** The largest amount representable without losing precision: `Number.MAX_SAFE_INTEGER` cents. */
const MAX_CENTS = Number.MAX_SAFE_INTEGER;

/** Raised when a value cannot be a whole, non-negative, exactly representable number of cents. */
export class InvalidMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMoneyError";
  }
}

/**
 * Constructs an amount from a whole number of cents.
 *
 * Throws `InvalidMoneyError` on a fractional value (`4850.5`), on a negative one, on `NaN` or
 * `Infinity`, and on anything past `Number.MAX_SAFE_INTEGER` where addition would start losing
 * cents. Nothing is rounded: a fractional number of cents is a bug at its source, and silently
 * absorbing it is how a Meter and a Cap stop agreeing.
 */
export function moneyFromCents(cents: number): Money {
  if (!Number.isFinite(cents)) {
    throw new InvalidMoneyError(`Money must be a finite number of BRL cents, received ${cents}`);
  }
  if (!Number.isInteger(cents)) {
    throw new InvalidMoneyError(
      `Money must be a whole number of BRL cents, received ${cents} — it is not rounded`,
    );
  }
  if (cents < 0) {
    throw new InvalidMoneyError(
      `Money must be zero or more BRL cents, received ${cents} — a cost is never negative`,
    );
  }
  if (cents > MAX_CENTS) {
    throw new InvalidMoneyError(
      `Money must be at most ${MAX_CENTS} BRL cents to stay exact, received ${cents}`,
    );
  }
  return cents as Money;
}

/** Zero: the amount a Meter starts from. */
export const ZERO_MONEY: Money = moneyFromCents(0);

/** `48`, `48.5` or `48.50` — never a comma, never an exponent, at most two decimal places. */
const DECIMAL = /^(\d+)(?:\.(\d{1,2}))?$/;

/**
 * Constructs an amount from a decimal string in reais, such as `"48.50"`.
 *
 * The separator is `.` because this is a machine-readable form — a price list, a provider's
 * response, a fixture. The comma belongs to display and lives in `formatMoney`, so `"48,50"` is
 * refused rather than guessed at.
 *
 * More than two decimal places is refused rather than rounded: `"0.005"` is either a price in a
 * unit this domain does not carry or a mistake, and both deserve to be seen.
 */
export function moneyFromDecimal(amount: string): Money {
  const matched = DECIMAL.exec(amount.trim());
  if (matched === null) {
    throw new InvalidMoneyError(
      `Money must be a decimal amount in reais with at most two decimal places, ` +
        `received ${JSON.stringify(amount)}`,
    );
  }

  const [, reais = "", decimals = ""] = matched;
  // Pad rather than divide: "48.5" is 50 cents, not 5.
  const centsDigits = decimals.padEnd(2, "0");
  const cents = Number(reais) * 100 + Number(centsDigits);

  return moneyFromCents(cents);
}

/** The amount as a plain number of cents — for serialising, and for nothing else. */
export function centsOf(amount: Money): number {
  return amount;
}

/**
 * Adds two amounts.
 *
 * The sum goes back through `moneyFromCents`, so an overflow past the exact-integer range fails
 * here instead of producing an amount that is quietly a cent short.
 */
export function addMoney(left: Money, right: Money): Money {
  return moneyFromCents(left + right);
}

/** `-1` when `left` is the smaller amount, `0` when both match, `1` when `left` is larger. */
export function compareMoney(left: Money, right: Money): -1 | 0 | 1 {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/**
 * Formats an amount for display in PT-BR: `R$ 1.234,56`.
 *
 * Digits are sliced and grouped as strings. There is no division by 100, and no `Intl` — beyond
 * keeping the module float-free, `Intl` output varies with the ICU data of the host, which would
 * make this function untestable across environments for no gain.
 */
export function formatMoney(amount: Money): string {
  const digits = String(centsOf(amount)).padStart(3, "0");
  const reais = digits.slice(0, -2);
  const cents = digits.slice(-2);

  return `R$ ${groupThousands(reais)},${cents}`;
}

function groupThousands(reais: string): string {
  const groups: string[] = [];
  for (let end = reais.length; end > 0; end -= 3) {
    groups.unshift(reais.slice(Math.max(0, end - 3), end));
  }
  return groups.join(".");
}
