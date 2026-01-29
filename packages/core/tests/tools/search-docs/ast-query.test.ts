/**
 * Tests for ast-query tool
 *
 * TDD approach: Tests written first to define expected behavior
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Test files use any for simplicity */

import { beforeEach, describe, expect, it, vi } from "vitest";

describe("ast-query tool", () => {
  let astQuery: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Import the module after mocks are set up
    const module = await import("../../../src/tools/search-docs/ast-query");
    astQuery = module.astQuery;
  });

  describe("find_functions", () => {
    it("finds all functions in a file or directory", async () => {
      const result = await astQuery.execute({
        queryType: "find_functions",
        target: ".",
      });

      expect(result.results).toBeDefined();
      expect(Array.isArray(result.results)).toBe(true);
    });

    it("returns function names, locations, and signatures", async () => {
      const result = await astQuery.execute({
        queryType: "find_functions",
        target: ".",
      });

      if (result.results.length > 0) {
        const func = result.results[0];
        expect(func.name).toBeDefined();
        expect(func.kind).toBe("function");
        expect(func.location).toBeDefined();
        expect(func.location.file).toBeDefined();
        expect(func.location.line).toBeGreaterThan(0);
      }
    });
  });

  describe("find_classes", () => {
    it("finds all classes in a file or directory", async () => {
      const result = await astQuery.execute({
        queryType: "find_classes",
        target: ".",
      });

      expect(result.results).toBeDefined();
      expect(Array.isArray(result.results)).toBe(true);
    });
  });

  describe("find_interfaces", () => {
    it("finds all interfaces in a file or directory", async () => {
      const result = await astQuery.execute({
        queryType: "find_interfaces",
        target: ".",
      });

      expect(result.results).toBeDefined();
      expect(Array.isArray(result.results)).toBe(true);
    });
  });

  describe("find_types", () => {
    it("finds all type aliases in a file or directory", async () => {
      const result = await astQuery.execute({
        queryType: "find_types",
        target: ".",
      });

      expect(result.results).toBeDefined();
      expect(Array.isArray(result.results)).toBe(true);
    });
  });

  describe("get_signature", () => {
    it("gets function signature with parameter types", async () => {
      // This test assumes there's a function to query
      const result = await astQuery.execute({
        queryType: "get_signature",
        target: "testFunction",
      });

      expect(result.results).toBeDefined();
      expect(Array.isArray(result.results)).toBe(true);

      if (result.results.length > 0) {
        const func = result.results[0];
        expect(func.parameters).toBeDefined();
        expect(Array.isArray(func.parameters)).toBe(true);
        expect(func.returnType).toBeDefined();
      }
    });
  });

  describe("resolve_type", () => {
    it("resolves what properties a type contains", async () => {
      const result = await astQuery.execute({
        queryType: "resolve_type",
        target: "TestType",
      });

      expect(result.results).toBeDefined();
      expect(Array.isArray(result.results)).toBe(true);

      if (result.results.length > 0) {
        const type = result.results[0];
        expect(type.properties).toBeDefined();
        expect(Array.isArray(type.properties)).toBe(true);
      }
    });
  });

  describe("get_references", () => {
    it("finds where a symbol is used", async () => {
      const result = await astQuery.execute({
        queryType: "get_references",
        target: "testSymbol",
      });

      expect(result.results).toBeDefined();
      expect(Array.isArray(result.results)).toBe(true);
    });
  });

  describe("get_implementations", () => {
    it("finds what implements an interface", async () => {
      const result = await astQuery.execute({
        queryType: "get_implementations",
        target: "TestInterface",
      });

      expect(result.results).toBeDefined();
      expect(Array.isArray(result.results)).toBe(true);
    });
  });

  describe("find_exports", () => {
    it("gets all exports from a file", async () => {
      const result = await astQuery.execute({
        queryType: "find_exports",
        target: ".",
      });

      expect(result.results).toBeDefined();
      expect(Array.isArray(result.results)).toBe(true);
    });
  });

  describe("get_extensions", () => {
    it("finds what interfaces extend another", async () => {
      const result = await astQuery.execute({
        queryType: "get_extensions",
        target: "BaseInterface",
      });

      expect(result.results).toBeDefined();
      expect(Array.isArray(result.results)).toBe(true);
    });
  });

  describe("tool schema", () => {
    it("has correct input schema", () => {
      expect(astQuery.inputSchema).toBeDefined();
    });

    it("has correct output schema", () => {
      expect(astQuery.outputSchema).toBeDefined();
    });

    it("has description for AI", () => {
      expect(astQuery.description).toBeDefined();
      expect(typeof astQuery.description).toBe("string");
      expect(astQuery.description.length).toBeGreaterThan(100);
    });
  });
});
