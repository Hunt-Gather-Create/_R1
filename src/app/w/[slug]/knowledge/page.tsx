"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { toast } from "sonner";
import {
  BookOpen,
  ChevronLeft,
  Code2,
  FilePlus2,
  FileText,
  FileUp,
  Folder,
  FolderOpen,
  FolderPlus,
  Layers,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import { getWorkspaceBySlug } from "@/lib/actions/workspace";
import { createKnowledgeImageUpload } from "@/lib/actions/knowledge";
import {
  useCreateKnowledgeDocument,
  useCreateKnowledgeDocumentUpload,
  useFinalizeKnowledgeDocumentUpload,
  useCreateKnowledgeFolder,
  useDeleteKnowledgeDocument,
  useDeleteKnowledgeFolder,
  useKnowledgeDocument,
  useKnowledgeDocuments,
  useKnowledgeFolders,
  useKnowledgeTags,
  useMoveKnowledgeDocument,
  useMoveKnowledgeFolder,
  useRenameKnowledgeDocument,
  useRenameKnowledgeFolder,
  useUpdateKnowledgeDocument,
} from "@/lib/hooks";
import { LexicalMarkdownEditor } from "@/components/ui/lexical-markdown-editor";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TreeView, type TreeDataItem } from "@/components/ui/tree-view";

const KnowledgeDocumentPreview = dynamic(
  () =>
    import("@/components/knowledge/document-preview").then(
      (module) => module.DocumentPreview
    ),
  {
    ssr: false,
    loading: () => (
      <div className="h-full w-full flex items-center justify-center text-sm text-muted-foreground">
        Loading preview...
      </div>
    ),
  }
);

const KNOWLEDGE_UPLOAD_ACCEPT =
  ".md,.markdown,.txt,.csv,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,text/markdown,text/plain,text/csv,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation";

function getDescendantFolderIds(
  folders: Array<{ id: string; parentFolderId: string | null }>,
  rootFolderId: string
): Set<string> {
  const descendants = new Set<string>([rootFolderId]);
  const queue = [rootFolderId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    for (const folder of folders) {
      if (folder.parentFolderId !== current || descendants.has(folder.id)) continue;
      descendants.add(folder.id);
      queue.push(folder.id);
    }
  }

  return descendants;
}

export default function KnowledgeBasePage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedDocumentId = searchParams.get("doc");

  const [workspace, setWorkspace] = useState<{
    id: string;
    name: string;
    slug: string;
  } | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(true);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [editorTitle, setEditorTitle] = useState("");
  const [editorContent, setEditorContent] = useState("");
  const [lastLoadedDocumentId, setLastLoadedDocumentId] = useState<string | null>(null);
  const [isSourceOpen, setIsSourceOpen] = useState(false);

  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [isCreateDocumentOpen, setIsCreateDocumentOpen] = useState(false);
  const [newDocumentTitle, setNewDocumentTitle] = useState("Untitled Document");
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const [documentToDelete, setDocumentToDelete] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [documentToRename, setDocumentToRename] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [renameDocumentTitle, setRenameDocumentTitle] = useState("");
  const [folderToDelete, setFolderToDelete] = useState<{ id: string; name: string } | null>(
    null
  );
  const [folderToRename, setFolderToRename] = useState<{ id: string; name: string } | null>(
    null
  );
  const [renameFolderName, setRenameFolderName] = useState("");

  useEffect(() => {
    if (!params.slug) return;

    let isMounted = true;
    setIsLoadingWorkspace(true);

    Promise.all([getWorkspaceBySlug(params.slug)]).then(([workspaceData]) => {
      if (!isMounted) return;
      setWorkspace(workspaceData ?? null);
      setWorkspaceId(workspaceData?.id ?? null);
      setIsLoadingWorkspace(false);
    });

    return () => {
      isMounted = false;
    };
  }, [params.slug]);

  const foldersQuery = useKnowledgeFolders(workspaceId);
  const documentsQuery = useKnowledgeDocuments({
    workspaceId,
    folderId: null,
    tag: selectedTag,
    query: searchQuery || null,
  });
  const tagsQuery = useKnowledgeTags(workspaceId);
  const selectedDocumentQuery = useKnowledgeDocument(selectedDocumentId);

  const createFolder = useCreateKnowledgeFolder(workspaceId ?? "");
  const createDocument = useCreateKnowledgeDocument(workspaceId ?? "");
  const createDocumentUpload = useCreateKnowledgeDocumentUpload(workspaceId ?? "");
  const finalizeDocumentUpload = useFinalizeKnowledgeDocumentUpload(workspaceId ?? "");
  const updateDocument = useUpdateKnowledgeDocument(workspaceId ?? "");
  const deleteDocument = useDeleteKnowledgeDocument(workspaceId ?? "");
  const deleteFolder = useDeleteKnowledgeFolder(workspaceId ?? "");
  const moveDocument = useMoveKnowledgeDocument(workspaceId ?? "");
  const moveFolder = useMoveKnowledgeFolder(workspaceId ?? "");
  const renameDocument = useRenameKnowledgeDocument(workspaceId ?? "");
  const renameFolder = useRenameKnowledgeFolder(workspaceId ?? "");
  const previewGenerationInFlightRef = useRef<Set<string>>(new Set());

  const folders = useMemo(() => foldersQuery.data ?? [], [foldersQuery.data]);
  const documents = useMemo(() => documentsQuery.data ?? [], [documentsQuery.data]);
  const tags = tagsQuery.data ?? [];
  const selectedDoc = selectedDocumentQuery.data;
  const selectedDocIsMarkdown = selectedDoc?.isMarkdown ?? false;

  const rootFolder = useMemo(
    () => folders.find((folder) => folder.parentFolderId === null) ?? null,
    [folders]
  );
  const selectedFolder = useMemo(
    () => folders.find((folder) => folder.id === selectedFolderId) ?? null,
    [folders, selectedFolderId]
  );

  const defaultParentFolderId = selectedFolderId ?? rootFolder?.id ?? null;
  const defaultParentFolderName =
    selectedFolder?.name ?? rootFolder?.name ?? "Knowledge Base";

  useEffect(() => {
    const doc = selectedDocumentQuery.data;
    if (!doc) return;
    if (doc.id === lastLoadedDocumentId) return;

    setEditorTitle(doc.title);
    setEditorContent(doc.content ?? "");
    setLastLoadedDocumentId(doc.id);
  }, [selectedDocumentQuery.data, lastLoadedDocumentId]);

  useEffect(() => {
    if (selectedDocumentId) return;
    setLastLoadedDocumentId(null);
  }, [selectedDocumentId]);

  const canSave =
    !!selectedDocumentId &&
    !!editorTitle.trim() &&
    !!selectedDoc &&
    (editorTitle !== selectedDoc.title ||
      (selectedDocIsMarkdown && editorContent !== (selectedDoc.content ?? "")));

  const setSelectedDocumentInUrl = useCallback(
    (documentId: string | null) => {
      const nextParams = new URLSearchParams(searchParams.toString());
      if (documentId) {
        nextParams.set("doc", documentId);
      } else {
        nextParams.delete("doc");
      }

      const query = nextParams.toString();
      const nextUrl = query ? `${pathname}?${query}` : pathname;
      router.replace(nextUrl, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const openDocument = useCallback(
    (documentId: string, folderId: string | null) => {
      setSelectedFolderId(folderId);
      setSelectedDocumentInUrl(documentId);
    },
    [setSelectedDocumentInUrl]
  );

  const runPreviewGeneration = useCallback(
    async (documentId: string, silent: boolean = false) => {
      const inFlight = previewGenerationInFlightRef.current;
      if (inFlight.has(documentId)) return;
      inFlight.add(documentId);

      try {
        const result = await finalizeDocumentUpload.mutateAsync(documentId);
        if (!silent && result.previewStatus === "failed") {
          toast.error(result.previewError || "Preview conversion failed");
        }
      } catch (error) {
        if (!silent) {
          toast.error(
            error instanceof Error ? error.message : "Failed to generate preview"
          );
        }
      } finally {
        inFlight.delete(documentId);
      }
    },
    [finalizeDocumentUpload]
  );

  useEffect(() => {
    if (!selectedDoc || selectedDoc.isMarkdown) return;
    if (selectedDoc.previewStatus !== "pending") return;
    void runPreviewGeneration(selectedDoc.id, true);
  }, [runPreviewGeneration, selectedDoc]);

  const handleCreateFolder = async () => {
    if (!workspaceId) return;

    const name = newFolderName.trim();
    if (!name) return;

    try {
      await createFolder.mutateAsync({
        name,
        parentFolderId: defaultParentFolderId,
      });
      setIsCreateFolderOpen(false);
      setNewFolderName("");
      toast.success("Folder created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create folder");
    }
  };

  const handleCreateDocument = async () => {
    if (!workspaceId) return;

    const title = newDocumentTitle.trim();
    if (!title) return;

    try {
      const doc = await createDocument.mutateAsync({
        title,
        content: "",
        folderId: defaultParentFolderId,
      });

      setIsCreateDocumentOpen(false);
      setNewDocumentTitle("Untitled Document");
      openDocument(doc.id, doc.folderId ?? null);
      toast.success("Document created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create document");
    }
  };

  const handleSelectUploadFile = () => {
    uploadInputRef.current?.click();
  };

  const handleUploadDocument = async (file: File) => {
    if (!workspaceId) return;

    let createdDocumentId: string | null = null;
    try {
      const { document, uploadUrl } = await createDocumentUpload.mutateAsync({
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        folderId: defaultParentFolderId,
      });
      createdDocumentId = document.id;

      const uploadResponse = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type || document.mimeType,
        },
        body: file,
      });

      if (!uploadResponse.ok) {
        throw new Error("Failed to upload file to R2");
      }

      openDocument(document.id, document.folderId ?? null);
      if (document.previewStatus === "pending") {
        toast.success("File uploaded. Generating preview...");
        void runPreviewGeneration(document.id, false);
      } else {
        toast.success("File uploaded");
      }
    } catch (error) {
      if (createdDocumentId) {
        try {
          await deleteDocument.mutateAsync(createdDocumentId);
        } catch (cleanupError) {
          console.error("Failed to clean up uploaded knowledge file:", cleanupError);
        }
      }
      toast.error(error instanceof Error ? error.message : "Failed to upload file");
    }
  };

  const handleSaveDocument = async () => {
    if (!selectedDocumentId) return;

    try {
      if (selectedDocIsMarkdown) {
        await updateDocument.mutateAsync({
          documentId: selectedDocumentId,
          title: editorTitle.trim(),
          content: editorContent,
        });
        toast.success("Document saved");
        return;
      }

      await renameDocument.mutateAsync({
        documentId: selectedDocumentId,
        title: editorTitle.trim(),
      });
      toast.success("File renamed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save document");
    }
  };

  const handleDeleteDocument = async () => {
    if (!documentToDelete) return;

    try {
      await deleteDocument.mutateAsync(documentToDelete.id);
      const isActiveDocument = selectedDocumentId === documentToDelete.id;

      setDocumentToDelete(null);
      if (isActiveDocument) {
        setSelectedDocumentInUrl(null);
        setEditorTitle("");
        setEditorContent("");
        setLastLoadedDocumentId(null);
      }

      toast.success("Document deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete document");
    }
  };

  const handleRenameDocument = async () => {
    if (!documentToRename) return;

    const title = renameDocumentTitle.trim();
    if (!title) return;

    try {
      await renameDocument.mutateAsync({
        documentId: documentToRename.id,
        title,
      });
      if (selectedDocumentId === documentToRename.id) {
        setEditorTitle(title);
      }
      setDocumentToRename(null);
      setRenameDocumentTitle("");
      toast.success("File renamed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to rename file");
    }
  };

  const handleDeleteFolder = async () => {
    if (!folderToDelete) return;

    const folderIdsToDelete = getDescendantFolderIds(folders, folderToDelete.id);

    try {
      await deleteFolder.mutateAsync(folderToDelete.id);
      setFolderToDelete(null);

      if (selectedFolderId && folderIdsToDelete.has(selectedFolderId)) {
        setSelectedFolderId(rootFolder?.id ?? null);
      }

      if (selectedDoc?.folderId && folderIdsToDelete.has(selectedDoc.folderId)) {
        setSelectedDocumentInUrl(null);
        setEditorTitle("");
        setEditorContent("");
        setLastLoadedDocumentId(null);
      }

      toast.success("Folder deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete folder");
    }
  };

  const handleRenameFolder = async () => {
    if (!folderToRename) return;

    const name = renameFolderName.trim();
    if (!name) return;

    try {
      await renameFolder.mutateAsync({
        folderId: folderToRename.id,
        name,
      });
      setFolderToRename(null);
      setRenameFolderName("");
      toast.success("Folder renamed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to rename folder");
    }
  };

  const handleManualSync = async () => {
    if (!workspaceId) return;

    try {
      const response = await fetch("/api/knowledge/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error ?? "Failed to sync");
      }

      toast.success("AI Search sync started");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to sync");
    }
  };

  const handleUploadImage = async (file: File): Promise<string> => {
    if (!workspaceId || !selectedDocumentId) {
      throw new Error("Create and select a document before uploading images");
    }

    try {
      const upload = await createKnowledgeImageUpload({
        workspaceId,
        documentId: selectedDocumentId,
        filename: file.name,
        mimeType: file.type || "image/png",
        size: file.size,
      });

      const uploadRes = await fetch(upload.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "image/png" },
        body: file,
      });

      if (!uploadRes.ok) {
        throw new Error("Failed to upload image to R2");
      }

      toast.success("Image uploaded");
      return upload.imageMarkdownUrl;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Image upload failed";
      toast.error(message);
      throw new Error(message);
    }
  };

  const handleTreeItemDrop = useCallback(
    async (source: TreeDataItem, target: TreeDataItem) => {
      if (!target.id.startsWith("folder:")) return;

      const targetFolderId = target.id.slice("folder:".length);
      if (!targetFolderId || targetFolderId === "__unfiled__") return;

      if (source.id.startsWith("doc:")) {
        const documentId = source.id.slice("doc:".length);
        const document = documents.find((candidate) => candidate.id === documentId);
        if (!document || document.folderId === targetFolderId) return;

        try {
          await moveDocument.mutateAsync({ documentId, targetFolderId });
          if (selectedDocumentId === documentId) {
            setSelectedFolderId(targetFolderId);
          }
          toast.success("File moved");
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Failed to move file");
        }
        return;
      }

      if (source.id.startsWith("folder:")) {
        const folderId = source.id.slice("folder:".length);
        if (!folderId || folderId === "__unfiled__") return;

        const folder = folders.find((candidate) => candidate.id === folderId);
        if (!folder || folder.parentFolderId === null || folder.parentFolderId === targetFolderId) {
          return;
        }
        const descendantIds = getDescendantFolderIds(folders, folderId);
        if (descendantIds.has(targetFolderId)) {
          toast.error("Cannot move a folder into its own subfolder");
          return;
        }

        try {
          await moveFolder.mutateAsync({
            folderId,
            targetParentFolderId: targetFolderId,
          });
          toast.success("Folder moved");
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Failed to move folder");
        }
      }
    },
    [
      documents,
      folders,
      moveDocument,
      moveFolder,
      selectedDocumentId,
      setSelectedFolderId,
    ]
  );

  const treeItems = useMemo<TreeDataItem[]>(() => {
    const foldersByParentId = new Map<string | null, typeof folders>();
    for (const folder of folders) {
      const key = folder.parentFolderId ?? null;
      const current = foldersByParentId.get(key) ?? [];
      current.push(folder);
      foldersByParentId.set(key, current);
    }

    const documentsByFolderId = new Map<string | null, typeof documents>();
    for (const doc of documents) {
      const key = doc.folderId ?? null;
      const current = documentsByFolderId.get(key) ?? [];
      current.push(doc);
      documentsByFolderId.set(key, current);
    }

    const sortFolders = (a: (typeof folders)[number], b: (typeof folders)[number]) =>
      a.name.localeCompare(b.name);
    const sortDocuments =
      (a: (typeof documents)[number], b: (typeof documents)[number]) =>
        a.title.localeCompare(b.title);

    const createDocumentNode = (doc: (typeof documents)[number]): TreeDataItem => ({
      id: `doc:${doc.id}`,
      name: doc.title,
      icon: FileText,
      onClick: () => openDocument(doc.id, doc.folderId ?? null),
      draggable: true,
      droppable: false,
      actions: (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`File actions for ${doc.title}`}
              onClick={(event) => event.stopPropagation()}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={(event) => {
                event.preventDefault();
                setDocumentToRename({ id: doc.id, title: doc.title });
                setRenameDocumentTitle(doc.title);
              }}
            >
              <Pencil className="mr-2 h-4 w-4" />
              Rename File
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={(event) => {
                event.preventDefault();
                setDocumentToDelete({ id: doc.id, title: doc.title });
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete File
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    });

    const createFolderNode = (folder: (typeof folders)[number]): TreeDataItem => {
      const childFolders = (foldersByParentId.get(folder.id) ?? [])
        .slice()
        .sort(sortFolders)
        .map(createFolderNode);
      const childDocuments = (documentsByFolderId.get(folder.id) ?? [])
        .slice()
        .sort(sortDocuments)
        .map(createDocumentNode);

      return {
        id: `folder:${folder.id}`,
        name: folder.name,
        icon: Folder,
        openIcon: FolderOpen,
        onClick: () => setSelectedFolderId(folder.id),
        draggable: folder.parentFolderId !== null,
        droppable: true,
        actions:
          folder.parentFolderId !== null ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Folder actions for ${folder.name}`}
                  onClick={(event) => event.stopPropagation()}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={(event) => {
                    event.preventDefault();
                    setFolderToRename({ id: folder.id, name: folder.name });
                    setRenameFolderName(folder.name);
                  }}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Rename Folder
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={(event) => {
                    event.preventDefault();
                    setFolderToDelete({ id: folder.id, name: folder.name });
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete Folder
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : undefined,
        children: [...childFolders, ...childDocuments],
      };
    };

    const rootNodes = (foldersByParentId.get(null) ?? [])
      .slice()
      .sort(sortFolders)
      .map(createFolderNode);

    const unfiledDocuments = (documentsByFolderId.get(null) ?? [])
      .slice()
      .sort(sortDocuments)
      .map(createDocumentNode);

    if (unfiledDocuments.length > 0) {
      rootNodes.push({
        id: "folder:__unfiled__",
        name: "Unfiled",
        icon: Folder,
        openIcon: FolderOpen,
        onClick: () => setSelectedFolderId(null),
        draggable: false,
        droppable: false,
        children: unfiledDocuments,
      });
    }

    return rootNodes;
  }, [documents, folders, openDocument]);

  const selectedTreeItemId =
    selectedDocumentId !== null
      ? `doc:${selectedDocumentId}`
      : selectedFolderId
        ? `folder:${selectedFolderId}`
        : undefined;

  if (isLoadingWorkspace) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        Loading workspace...
      </div>
    );
  }

  if (!workspaceId) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        Workspace not found
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <header className="h-12 border-b border-border px-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push(`/w/${params.slug}`)}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Back
          </button>
          {workspace ? (
            <div className="flex items-center gap-2 text-sm">
              <div className="w-5 h-5 bg-primary rounded flex items-center justify-center">
                <Layers className="w-3 h-3 text-primary-foreground" />
              </div>
              <span className="font-medium">{workspace.name}</span>
              <span className="text-muted-foreground">/</span>
              <BookOpen className="w-4 h-4 text-muted-foreground" />
              <span className="text-muted-foreground">Knowledge</span>
            </div>
          ) : null}
        </div>
      </header>

      <div className="h-14 border-b border-border px-4 flex items-center justify-between gap-2">
        <Button size="sm" variant="outline" onClick={handleManualSync}>
          <RefreshCw className="w-4 h-4 mr-1.5" />
          Sync Index
        </Button>

        <div className="w-[320px] relative">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="pl-8 h-9"
            placeholder="Search documents..."
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <aside className="w-80 border-r border-border flex min-h-0 flex-col">
          <div className="h-12 border-b border-border px-3 flex items-center justify-between">
            <p className="text-sm font-medium">Knowledge</p>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="outline" aria-label="Create">
                  <Plus className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setIsCreateFolderOpen(true)}>
                  <FolderPlus className="mr-2 h-4 w-4" />
                  New Folder
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setIsCreateDocumentOpen(true)}>
                  <FilePlus2 className="mr-2 h-4 w-4" />
                  New File
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    handleSelectUploadFile();
                  }}
                >
                  <FileUp className="mr-2 h-4 w-4" />
                  Upload File
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <input
              ref={uploadInputRef}
              type="file"
              className="hidden"
              accept={KNOWLEDGE_UPLOAD_ACCEPT}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                void handleUploadDocument(file);
              }}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-2">
            {treeItems.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">No folders or files yet</p>
            ) : (
              <TreeView
                data={treeItems}
                selectedItemId={selectedTreeItemId}
                onItemDrop={(source, target) => {
                  void handleTreeItemDrop(source, target);
                }}
              />
            )}
          </div>

          <div className="border-t border-border p-3 space-y-1">
            <p className="text-xs font-medium text-muted-foreground mb-2">Tags</p>
            <button
              className={`w-full text-left px-2 py-1.5 rounded text-sm ${
                selectedTag === null ? "bg-accent" : "hover:bg-accent/60"
              }`}
              onClick={() => setSelectedTag(null)}
            >
              All Tags
            </button>
            {tags.map((tag) => (
              <button
                key={tag}
                className={`w-full text-left px-2 py-1.5 rounded text-sm ${
                  selectedTag === tag ? "bg-accent" : "hover:bg-accent/60"
                }`}
                onClick={() => setSelectedTag(tag)}
              >
                #{tag}
              </button>
            ))}
          </div>
        </aside>

        <main className="flex-1 min-w-0 flex">
          {!selectedDocumentId ? (
            <div className="h-full w-full flex items-center justify-center text-sm text-muted-foreground">
              Select a file to edit or preview
            </div>
          ) : selectedDocumentQuery.isLoading && !selectedDoc ? (
            <div className="h-full w-full flex items-center justify-center text-sm text-muted-foreground">
              Loading file...
            </div>
          ) : (
            <div className="w-full min-w-0 flex flex-col">
              <div className="h-12 border-b border-border px-3 flex items-center gap-2">
                <Input
                  value={editorTitle}
                  onChange={(event) => setEditorTitle(event.target.value)}
                  placeholder="Document title"
                  className="h-8"
                />
                {selectedDocIsMarkdown ? (
                  <Button size="sm" variant="outline" onClick={() => setIsSourceOpen(true)}>
                    <Code2 className="w-4 h-4 mr-1.5" />
                    Source
                  </Button>
                ) : null}
                <Button size="sm" onClick={handleSaveDocument} disabled={!canSave}>
                  <Save className="w-4 h-4 mr-1.5" />
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => {
                    if (!selectedDocumentId) return;
                    setDocumentToDelete({
                      id: selectedDocumentId,
                      title: editorTitle.trim() || selectedDoc?.title || "Untitled",
                    });
                  }}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>

              <div className="flex-1 min-h-0 p-3 overflow-hidden">
                {selectedDocIsMarkdown ? (
                  <LexicalMarkdownEditor
                    key={selectedDocumentId}
                    value={editorContent}
                    onChange={setEditorContent}
                    placeholder="Write markdown..."
                    className="h-full"
                    onUploadImage={handleUploadImage}
                  />
                ) : selectedDoc ? (
                  <KnowledgeDocumentPreview
                    title={selectedDoc.title}
                    previewUrl={selectedDoc.previewUrl}
                    downloadUrl={selectedDoc.downloadUrl}
                    fileExtension={selectedDoc.fileExtension}
                    previewStatus={selectedDoc.previewStatus}
                    previewError={selectedDoc.previewError}
                    onRetryPreview={() => {
                      if (!selectedDoc) return;
                      void runPreviewGeneration(selectedDoc.id, false);
                    }}
                    isRetryingPreview={finalizeDocumentUpload.isPending}
                  />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-sm text-muted-foreground">
                    Preview unavailable
                  </div>
                )}
              </div>

              {selectedDoc?.backlinks?.length ? (
                <div className="border-t border-border p-3">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Backlinks</p>
                  <div className="space-y-1">
                    {selectedDoc.backlinks.map((backlink) => (
                      <p key={backlink.id} className="text-sm">
                        {backlink.title}
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </main>
      </div>

      <Dialog open={isSourceOpen} onOpenChange={setIsSourceOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Markdown Source</DialogTitle>
          </DialogHeader>
          <textarea
            readOnly
            value={editorContent}
            className="h-[60vh] w-full rounded-md border border-border bg-background p-3 font-mono text-xs leading-5"
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={isCreateFolderOpen}
        onOpenChange={(open) => {
          setIsCreateFolderOpen(open);
          if (!open) {
            setNewFolderName("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Folder</DialogTitle>
            <DialogDescription>
              Add a new folder in {defaultParentFolderName}.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreateFolder();
            }}
          >
            <Input
              autoFocus
              value={newFolderName}
              onChange={(event) => setNewFolderName(event.target.value)}
              placeholder="Folder name"
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCreateFolderOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!newFolderName.trim() || createFolder.isPending}>
                {createFolder.isPending ? "Creating..." : "Create Folder"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isCreateDocumentOpen}
        onOpenChange={(open) => {
          setIsCreateDocumentOpen(open);
          if (!open) {
            setNewDocumentTitle("Untitled Document");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create File</DialogTitle>
            <DialogDescription>
              Add a new file in {defaultParentFolderName}.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreateDocument();
            }}
          >
            <Input
              autoFocus
              value={newDocumentTitle}
              onChange={(event) => setNewDocumentTitle(event.target.value)}
              placeholder="File title"
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCreateDocumentOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!newDocumentTitle.trim() || createDocument.isPending}
              >
                {createDocument.isPending ? "Creating..." : "Create File"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={folderToRename !== null}
        onOpenChange={(open) => {
          if (!open) {
            setFolderToRename(null);
            setRenameFolderName("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Folder</DialogTitle>
            <DialogDescription>Choose a new folder name.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void handleRenameFolder();
            }}
          >
            <Input
              autoFocus
              value={renameFolderName}
              onChange={(event) => setRenameFolderName(event.target.value)}
              placeholder="Folder name"
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setFolderToRename(null);
                  setRenameFolderName("");
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!renameFolderName.trim() || renameFolder.isPending}
              >
                {renameFolder.isPending ? "Renaming..." : "Rename Folder"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={documentToRename !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDocumentToRename(null);
            setRenameDocumentTitle("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename File</DialogTitle>
            <DialogDescription>Choose a new file name.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void handleRenameDocument();
            }}
          >
            <Input
              autoFocus
              value={renameDocumentTitle}
              onChange={(event) => setRenameDocumentTitle(event.target.value)}
              placeholder="File title"
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setDocumentToRename(null);
                  setRenameDocumentTitle("");
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!renameDocumentTitle.trim() || renameDocument.isPending}
              >
                {renameDocument.isPending ? "Renaming..." : "Rename File"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={documentToDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDocumentToDelete(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete file?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete{" "}
              {documentToDelete ? `"${documentToDelete.title}"` : "this file"} and its
              uploaded images.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteDocument();
              }}
              disabled={deleteDocument.isPending}
            >
              {deleteDocument.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={folderToDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setFolderToDelete(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete folder?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete{" "}
              {folderToDelete ? `"${folderToDelete.name}"` : "this folder"}, all nested
              folders, and all files inside it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteFolder();
              }}
              disabled={deleteFolder.isPending}
            >
              {deleteFolder.isPending ? "Deleting..." : "Delete Folder"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
