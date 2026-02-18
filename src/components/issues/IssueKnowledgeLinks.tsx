"use client";

import { useMemo, useState } from "react";
import { Link2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useIssueKnowledgeLinks,
  useKnowledgeDocuments,
  useLinkKnowledgeToIssue,
  useUnlinkKnowledgeFromIssue,
} from "@/lib/hooks";
import { toast } from "sonner";

interface IssueKnowledgeLinksProps {
  issueId: string;
  workspaceId: string;
}

export function IssueKnowledgeLinks({ issueId, workspaceId }: IssueKnowledgeLinksProps) {
  const [query, setQuery] = useState("");
  const [selectedDocId, setSelectedDocId] = useState("");

  const linkedDocsQuery = useIssueKnowledgeLinks(issueId);
  const docsQuery = useKnowledgeDocuments({
    workspaceId,
    query,
  });

  const linkMutation = useLinkKnowledgeToIssue(issueId, workspaceId);
  const unlinkMutation = useUnlinkKnowledgeFromIssue(issueId);

  const linkedDocIds = useMemo(
    () => new Set((linkedDocsQuery.data ?? []).map((doc) => doc.id)),
    [linkedDocsQuery.data]
  );
  const availableDocs = (docsQuery.data ?? []).filter((doc) => !linkedDocIds.has(doc.id));

  const handleLink = async () => {
    if (!selectedDocId) return;
    try {
      await linkMutation.mutateAsync(selectedDocId);
      setSelectedDocId("");
      toast.success("Document linked");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to link document");
    }
  };

  const handleUnlink = async (documentId: string) => {
    try {
      await unlinkMutation.mutateAsync(documentId);
      toast.success("Document unlinked");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to unlink document");
    }
  };

  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground block mb-2">
        Knowledge
      </label>

      <div className="rounded-md border border-border p-3 space-y-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search knowledge docs..."
          className="h-8"
        />

        <div className="flex items-center gap-2">
          <select
            className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-sm"
            value={selectedDocId}
            onChange={(e) => setSelectedDocId(e.target.value)}
          >
            <option value="">Select document to link</option>
            {availableDocs.map((doc) => (
              <option key={doc.id} value={doc.id}>
                {doc.title}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" onClick={handleLink} disabled={!selectedDocId}>
            <Link2 className="w-4 h-4 mr-1.5" />
            Link
          </Button>
        </div>

        <div className="space-y-1">
          {(linkedDocsQuery.data ?? []).map((doc) => (
            <div
              key={doc.id}
              className="flex items-center justify-between px-2 py-1.5 rounded bg-muted/40"
            >
              <span className="text-sm truncate">{doc.title}</span>
              <button
                className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                onClick={() => handleUnlink(doc.id)}
                title="Unlink document"
              >
                <Unlink className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {(linkedDocsQuery.data ?? []).length === 0 && (
            <p className="text-xs text-muted-foreground">No linked documents</p>
          )}
        </div>
      </div>
    </div>
  );
}
