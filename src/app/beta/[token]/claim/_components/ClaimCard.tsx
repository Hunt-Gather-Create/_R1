"use client";

import { useRef, useState, useCallback } from "react";
import { claimInviteCode } from "@/lib/actions/invite-codes";

interface ClaimCardProps {
  token: string;
  isValid: boolean;
  errorMessage?: string;
  isAuthenticated: boolean;
}

export function ClaimCard({
  token,
  isValid,
  errorMessage,
  isAuthenticated,
}: ClaimCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(
    isValid ? null : (errorMessage ?? "Invalid invite code.")
  );
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const card = cardRef.current;
      if (!card) return;

      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      const rotateX = ((y - centerY) / centerY) * 8;
      const rotateY = ((x - centerX) / centerX) * -8;

      setTransform(
        `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`
      );
    },
    []
  );

  const handleMouseLeave = useCallback(() => {
    setTransform("");
  }, []);

  async function handleClaim() {
    if (!isValid || claiming) return;

    setClaiming(true);
    setError(null);

    try {
      await claimInviteCode(token);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong."
      );
      setClaiming(false);
    }
  }

  function handleSignIn() {
    // Full page navigation — router.push would try an RSC fetch
    // which fails with CORS when /login redirects to WorkOS
    window.location.href = `/login?returnTo=/beta/${token}/claim`;
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-gradient-to-b from-black/10 to-transparent" style={{ backgroundColor: "#1a1a1a" }}>
      {/* Outer card — dark shell */}
      <div
        ref={cardRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="group relative z-10 w-full max-w-[320px] mx-4 rounded-2xl bg-[#2a2a2a] border border-white/10 p-3 pb-4 shadow-2xl"
        style={{
          transform,
          transition: "transform 0.15s ease-out",
        }}
      >
        {/* _R1 label */}
        <p className="text-xs text-white/50 font-medium mb-2 ml-1">_R1</p>

        {/* Inner card — blurred bg image */}
        <div
          className="relative rounded-xl overflow-hidden bg-cover bg-center"
          style={{ backgroundImage: "url(/images/invite-bg.webp)" }}
        >
          {/* Content over image */}
          <div className="relative z-10 px-5 pt-6 pb-5 flex flex-col min-h-[360px]">
            {/* Heading */}
            <h1
              className="text-[28px] leading-tight font-bold text-gray-900"
              style={{ textShadow: "0 1px 3px rgba(255,255,255,0.4)" }}
            >
              {isValid
                ? "You\u2019ve been invited to join Round 1"
                : "Invalid Invitation"}
            </h1>

            {/* Error */}
            {error ? (
              <p className="text-red-700 text-sm mt-3">{error}</p>
            ) : null}

            {/* Spacer */}
            <div className="flex-1" />

            {/* CTA Button — frosted glass */}
            {isValid && isAuthenticated ? (
              <button
                onClick={handleClaim}
                disabled={claiming}
                className="w-full py-3 px-6 rounded-lg bg-white/40 backdrop-blur-sm border border-white/30 text-gray-800 font-semibold text-sm cursor-pointer hover:bg-white/60 group-hover:scale-[1.03] active:scale-[0.98] transition-all duration-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {claiming ? "Accepting..." : "Accept Invitation"}
              </button>
            ) : isValid ? (
              <button
                onClick={handleSignIn}
                className="w-full py-3 px-6 rounded-lg bg-white/40 backdrop-blur-sm border border-white/30 text-gray-800 font-semibold text-sm cursor-pointer hover:bg-white/60 group-hover:scale-[1.03] active:scale-[0.98] transition-all duration-500"
              >
                Sign In to Accept
              </button>
            ) : null}
          </div>
        </div>

        {/* Attribution — bottom right of outer card */}
        <div className="flex items-center justify-end gap-1.5 mt-3 mr-1">
          <span className="text-xs text-white/40">Invited by Civilization</span>
          <span className="w-4 h-4 rounded-full bg-emerald-500/80 flex items-center justify-center text-[8px] text-white font-bold">
            C
          </span>
        </div>
      </div>
    </div>
  );
}
