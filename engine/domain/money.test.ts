import { describe, expect, it } from "vitest";

import {
  InvalidMoneyError,
  ZERO_MONEY,
  addMoney,
  centsOf,
  compareMoney,
  formatMoney,
  moneyFromCents,
  moneyFromDecimal,
  type Money,
} from "@engine/domain/money";

/** Stands in for any domain operation that accrues cost and nothing else. */
function accrue(amount: Money): number {
  return centsOf(amount);
}

describe("Money as whole BRL cents", () => {
  it("keeps the cents it was built from", () => {
    expect(centsOf(moneyFromCents(4850))).toBe(4850);
    expect(centsOf(ZERO_MONEY)).toBe(0);
  });

  it("builds from a decimal string in reais", () => {
    expect(centsOf(moneyFromDecimal("48.50"))).toBe(4850);
    expect(centsOf(moneyFromDecimal("48.5"))).toBe(4850);
    expect(centsOf(moneyFromDecimal("48"))).toBe(4800);
    expect(centsOf(moneyFromDecimal("0.07"))).toBe(7);
    expect(centsOf(moneyFromDecimal("0"))).toBe(0);
    expect(centsOf(moneyFromDecimal(" 12.34 "))).toBe(1234);
  });

  it("refuses a decimal string with more than two decimal places", () => {
    expect(() => moneyFromDecimal("48.500")).toThrow(InvalidMoneyError);
    expect(() => moneyFromDecimal("0.005")).toThrow(/at most two decimal places/);
  });

  it("refuses a decimal string that is not a plain non-negative amount", () => {
    for (const rejected of ["", "48,50", "48.", ".50", "-1.00", "1e2", "R$ 48,50", "abc", "4 8"]) {
      expect(() => moneyFromDecimal(rejected), rejected).toThrow(InvalidMoneyError);
    }
  });

  it("refuses a fractional number of cents instead of rounding it", () => {
    expect(() => moneyFromCents(4850.5)).toThrow(InvalidMoneyError);
    expect(() => moneyFromCents(0.1)).toThrow(/is not rounded/);
    // The float that started the whole no-floats rule: 0.1 + 0.2 is 0.30000000000000004.
    expect(() => moneyFromCents((0.1 + 0.2) * 100)).toThrow(InvalidMoneyError);
  });

  it("refuses a negative amount, because a cost never is", () => {
    expect(() => moneyFromCents(-1)).toThrow(/a cost is never negative/);
  });

  it("refuses values that are not finite, or too large to stay exact", () => {
    expect(() => moneyFromCents(Number.NaN)).toThrow(/finite/);
    expect(() => moneyFromCents(Number.POSITIVE_INFINITY)).toThrow(/finite/);
    expect(() => moneyFromCents(Number.MAX_SAFE_INTEGER + 2)).toThrow(/stay exact/);
  });

  it("adds without losing cents across many small increments", () => {
    const oneCent = moneyFromCents(1);
    let total = ZERO_MONEY;
    for (let increment = 0; increment < 1000; increment += 1) {
      total = addMoney(total, oneCent);
    }

    expect(centsOf(total)).toBe(1000);
    expect(formatMoney(total)).toBe("R$ 10,00");
  });

  it("adds ten cents ten times and lands exactly on one real", () => {
    const tenCents = moneyFromDecimal("0.10");
    let total = ZERO_MONEY;
    for (let increment = 0; increment < 10; increment += 1) {
      total = addMoney(total, tenCents);
    }

    expect(compareMoney(total, moneyFromDecimal("1.00"))).toBe(0);
  });

  it("refuses an addition that would leave the exact-integer range", () => {
    const nearlyMax = moneyFromCents(Number.MAX_SAFE_INTEGER);

    expect(() => addMoney(nearlyMax, moneyFromCents(2))).toThrow(InvalidMoneyError);
  });

  it("compares two amounts", () => {
    const smaller = moneyFromDecimal("48.49");
    const larger = moneyFromDecimal("48.50");

    expect(compareMoney(smaller, larger)).toBe(-1);
    expect(compareMoney(larger, smaller)).toBe(1);
    expect(compareMoney(larger, moneyFromCents(4850))).toBe(0);
  });

  it("formats for display in PT-BR, grouping thousands", () => {
    expect(formatMoney(ZERO_MONEY)).toBe("R$ 0,00");
    expect(formatMoney(moneyFromCents(7))).toBe("R$ 0,07");
    expect(formatMoney(moneyFromCents(70))).toBe("R$ 0,70");
    expect(formatMoney(moneyFromCents(4850))).toBe("R$ 48,50");
    expect(formatMoney(moneyFromCents(100000))).toBe("R$ 1.000,00");
    expect(formatMoney(moneyFromCents(123456789))).toBe("R$ 1.234.567,89");
  });

  it("round-trips a decimal amount through cents and back to display", () => {
    // Below a thousand the display form is the parsed form with a comma; grouping above that is
    // covered by the formatting case, and is why this list stops at three digits.
    for (const amount of ["0.00", "0.01", "0.99", "1.00", "9.99", "48.50", "999.99"]) {
      expect(formatMoney(moneyFromDecimal(amount)), amount).toBe(`R$ ${amount.replace(".", ",")}`);
    }
  });

  it("refuses a raw number where an amount is required", () => {
    // @ts-expect-error a raw number is not a whole number of cents until it has been checked
    const rejected = (): number => accrue(4850);

    // The type error is the proof; the call still runs, because the brand is erased at runtime.
    expect(rejected()).toBe(4850);
  });

  it("refuses the result of raw arithmetic where an amount is required", () => {
    const left = moneyFromCents(10);
    const right = moneyFromCents(32);

    // @ts-expect-error `left + right` is a plain number: it has to go back through moneyFromCents
    const rejected = (): Money => left + right;

    expect(centsOf(addMoney(left, right))).toBe(rejected());
  });

  it("stays assignable to number, so an amount can be compared and printed", () => {
    const cents: number = moneyFromCents(4850);

    expect(cents > 4000).toBe(true);
  });
});
