import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NotFoundPage } from "../../src/pages/NotFoundPage";

describe("NotFoundPage", () => {
  test("renders a 404 result with a button back to the swap page", () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("404")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go to Swap" })).toBeInTheDocument();
  });
});
