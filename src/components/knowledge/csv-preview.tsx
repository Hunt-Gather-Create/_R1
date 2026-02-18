"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

const CSV_PREVIEW_MAX_ROWS = 300;
const CSV_PREVIEW_MAX_COLS = 50;

interface CsvPreviewProps {
  previewUrl: string;
  title: string;
}

function toColumnLabel(index: number): string {
  let value = index + 1;
  let label = "";

  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }

  return label;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [[]];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        value += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && character === ",") {
      rows[rows.length - 1].push(value);
      value = "";
      continue;
    }

    if (!inQuotes && (character === "\n" || character === "\r")) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }
      rows[rows.length - 1].push(value);
      value = "";
      rows.push([]);
      continue;
    }

    value += character;
  }

  rows[rows.length - 1].push(value);

  return rows.filter((row) => row.some((cell) => cell.trim().length > 0));
}

export function CsvPreview({ previewUrl, title }: CsvPreviewProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<string[][]>([]);

  useEffect(() => {
    const controller = new AbortController();
    let isMounted = true;

    const loadCsv = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(previewUrl, {
          method: "GET",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error("Could not load CSV preview");
        }

        const text = await response.text();
        if (!isMounted) return;
        setRows(parseCsv(text));
      } catch (csvError) {
        if (!isMounted || controller.signal.aborted) return;
        const message = csvError instanceof Error ? csvError.message : "Failed to load preview";
        setError(message);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadCsv();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [previewUrl]);

  const limitedRows = useMemo(() => rows.slice(0, CSV_PREVIEW_MAX_ROWS), [rows]);
  const columnCount = useMemo(() => {
    return limitedRows.reduce((max, row) => Math.max(max, row.length), 0);
  }, [limitedRows]);

  if (isLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading preview...
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full w-full flex items-center justify-center px-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-2 text-center">
          <AlertTriangle className="h-4 w-4" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col bg-muted/20">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-max min-w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-background">
            <tr>
              <th className="sticky left-0 z-20 border border-border bg-background px-2 py-1 text-right text-muted-foreground">
                #
              </th>
              {Array.from({ length: Math.min(columnCount, CSV_PREVIEW_MAX_COLS) }).map(
                (_, columnIndex) => (
                  <th
                    key={`column-${columnIndex}`}
                    className="border border-border bg-background px-2 py-1 text-left font-medium text-muted-foreground"
                  >
                    {toColumnLabel(columnIndex)}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {limitedRows.length === 0 ? (
              <tr>
                <td className="border border-border px-3 py-2 text-muted-foreground" colSpan={2}>
                  {title} is empty
                </td>
              </tr>
            ) : (
              limitedRows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  <th className="sticky left-0 z-10 border border-border bg-background px-2 py-1 text-right font-medium text-muted-foreground">
                    {rowIndex + 1}
                  </th>
                  {Array.from({ length: Math.min(columnCount, CSV_PREVIEW_MAX_COLS) }).map(
                    (_, columnIndex) => (
                      <td
                        key={`cell-${rowIndex}-${columnIndex}`}
                        className="border border-border px-2 py-1 align-top whitespace-pre-wrap break-words min-w-[120px] max-w-[420px]"
                      >
                        {row[columnIndex] ?? ""}
                      </td>
                    )
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {rows.length > CSV_PREVIEW_MAX_ROWS || columnCount > CSV_PREVIEW_MAX_COLS ? (
        <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          Showing first {CSV_PREVIEW_MAX_ROWS} rows and {CSV_PREVIEW_MAX_COLS} columns.
        </div>
      ) : null}
    </div>
  );
}
