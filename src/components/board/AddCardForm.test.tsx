import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddCardForm } from "./AddCardForm";

describe("AddCardForm", () => {
  it("should render add button initially", () => {
    const onAdd = vi.fn();
    render(<AddCardForm onAdd={onAdd} />);

    expect(screen.getByRole("button", { name: /add a card/i })).toBeInTheDocument();
  });

  it("should show input form when add button is clicked", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<AddCardForm onAdd={onAdd} />);

    await user.click(screen.getByRole("button", { name: /add a card/i }));

    expect(screen.getByPlaceholderText(/enter card title/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^add$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("should call onAdd with trimmed title when form is submitted", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<AddCardForm onAdd={onAdd} />);

    await user.click(screen.getByRole("button", { name: /add a card/i }));
    await user.type(screen.getByPlaceholderText(/enter card title/i), "  New Card  ");
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    expect(onAdd).toHaveBeenCalledWith("New Card");
  });

  it("should close form after submitting", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<AddCardForm onAdd={onAdd} />);

    await user.click(screen.getByRole("button", { name: /add a card/i }));
    await user.type(screen.getByPlaceholderText(/enter card title/i), "New Card");
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    expect(screen.getByRole("button", { name: /add a card/i })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/enter card title/i)).not.toBeInTheDocument();
  });

  it("should close form when cancel is clicked", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<AddCardForm onAdd={onAdd} />);

    await user.click(screen.getByRole("button", { name: /add a card/i }));
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.getByRole("button", { name: /add a card/i })).toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("should close form when Escape key is pressed", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<AddCardForm onAdd={onAdd} />);

    await user.click(screen.getByRole("button", { name: /add a card/i }));
    await user.keyboard("{Escape}");

    expect(screen.getByRole("button", { name: /add a card/i })).toBeInTheDocument();
  });

  it("should disable add button when input is empty", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<AddCardForm onAdd={onAdd} />);

    await user.click(screen.getByRole("button", { name: /add a card/i }));

    expect(screen.getByRole("button", { name: /^add$/i })).toBeDisabled();
  });

  it("should disable add button when input contains only whitespace", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<AddCardForm onAdd={onAdd} />);

    await user.click(screen.getByRole("button", { name: /add a card/i }));
    await user.type(screen.getByPlaceholderText(/enter card title/i), "   ");

    expect(screen.getByRole("button", { name: /^add$/i })).toBeDisabled();
  });

  it("should not submit when title is empty", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<AddCardForm onAdd={onAdd} />);

    await user.click(screen.getByRole("button", { name: /add a card/i }));

    // Try to submit via Enter key
    const input = screen.getByPlaceholderText(/enter card title/i);
    fireEvent.submit(input.closest("form")!);

    expect(onAdd).not.toHaveBeenCalled();
  });
});
