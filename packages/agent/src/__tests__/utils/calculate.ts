import { type Static, Type } from "typebox";
import type { AgentTool, AgentToolResult } from "../../types";

export interface CalculateResult extends AgentToolResult<undefined> {
  content: Array<{ type: "text"; text: string }>;
  details: undefined;
}

// Simple arithmetic expression evaluator (no eval / Function constructor)
function evaluateMathExpression(expr: string): number {
  const match = expr.match(/(?:\d+(?:\.\d+)?)|[+\-*/()]|\S/g);
  if (!match) throw new Error("Empty expression");
  const tokens: string[] = match;

  let pos = 0;

  function peek(): string | undefined {
    return tokens[pos];
  }

  function consume(): string {
    return tokens[pos++]!;
  }

  function parseNumber(): number {
    const token = consume();
    const num = Number.parseFloat(token);
    if (Number.isNaN(num)) throw new Error(`Unexpected token: ${token}`);
    return num;
  }

  function parseFactor(): number {
    if (peek() === "(") {
      consume();
      const val = parseExpression();
      if (peek() !== ")") throw new Error("Missing closing parenthesis");
      consume();
      return val;
    }
    if (peek() === "-") {
      consume();
      return -parseFactor();
    }
    return parseNumber();
  }

  function parseTerm(): number {
    let left = parseFactor();
    while (peek() === "*" || peek() === "/") {
      const op = consume();
      const right = parseFactor();
      left = op === "*" ? left * right : left / right;
    }
    return left;
  }

  function parseExpression(): number {
    let left = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = consume();
      const right = parseTerm();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  const result = parseExpression();
  if (pos < tokens.length) throw new Error(`Unexpected token: ${tokens[pos]}`);
  return result;
}

export function calculate(expression: string): CalculateResult {
  try {
    const result = evaluateMathExpression(expression);
    return {
      content: [{ type: "text", text: `${expression} = ${result}` }],
      details: undefined,
    };
  } catch (e: any) {
    throw new Error(e.message || String(e));
  }
}

const calculateSchema = Type.Object({
  expression: Type.String({
    description: "The mathematical expression to evaluate",
  }),
});

type CalculateParams = Static<typeof calculateSchema>;

export const calculateTool: AgentTool<typeof calculateSchema, undefined> = {
  label: "Calculator",
  name: "calculate",
  description: "Evaluate mathematical expressions",
  parameters: calculateSchema,
  execute: async (_toolCallId: string, args: CalculateParams) => calculate(args.expression),
};
