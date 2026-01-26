import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "@/lib/query-keys";

export function useSendToAI() {
  const queryClient = useQueryClient();

  const sendToAI = useCallback(
    async (issueId: string) => {
      try {
        const response = await fetch("/api/ai/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ issueId }),
        });

        if (response.ok) {
          toast.success("Sent to AI successfully");
          await queryClient.invalidateQueries({ queryKey: queryKeys.board.all });
        } else {
          toast.error("Failed to send to AI");
        }
      } catch {
        toast.error("Failed to send to AI");
      }
    },
    [queryClient]
  );

  return { sendToAI };
}
