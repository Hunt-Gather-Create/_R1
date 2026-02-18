import { escapeHtml, htmlWrapper, profileImageHtml } from "./index";

export function renderGoogleSearchAd(content: unknown, _mediaUrls?: string[]): string {
  const c = content as {
    company?: { name?: string; logo?: string; url?: string; imageBackgroundColor?: string | null };
    search?: {
      title?: string;
      description?: string;
      link?: string;
      location?: string;
      suggestedSearches?: Array<{ title?: string; link?: string }>;
    };
  };

  const company = c.company;
  const companyName = escapeHtml(company?.name || "Company");
  const companyUrl = escapeHtml(company?.url || "#");
  const profileImg = profileImageHtml(
    company?.logo,
    company?.imageBackgroundColor,
    28,
    companyName,
    true
  );
  const title = escapeHtml(c.search?.title || "");
  const description = escapeHtml(c.search?.description || "");
  const link = escapeHtml(c.search?.link || "#");
  const location = c.search?.location ? escapeHtml(c.search.location) : null;
  const searches = c.search?.suggestedSearches || [];

  const suggestedHtml = searches.length
    ? `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:8px;">
        ${searches.map((s, i) => `${i > 0 ? '<span style="width:2px;height:2px;border-radius:50%;background:#1f1f1f;display:inline-block;"></span>' : ""}<a href="${escapeHtml(s.link || "#")}" style="color:#1a0dab;font-size:14px;text-decoration:none;white-space:nowrap;">${escapeHtml(s.title || "")}</a>`).join("")}
      </div>`
    : "";

  const body = `
<div style="max-width:600px;width:100%;background:#fff;border:1px solid #d2d2d2;border-radius:8px;padding:16px;font-family:Roboto,Arial,sans-serif;color:#202124;font-size:14px;">
  <div style="font-weight:700;margin-bottom:8px;">Sponsored</div>
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
    ${profileImg}
    <div>
      <div style="font-size:14px;font-weight:500;">${companyName}</div>
      <div style="font-size:12px;color:#4d5156;">${companyUrl}</div>
    </div>
  </div>
  <a href="${link}" style="font-size:20px;color:#1a0dab;text-decoration:none;display:block;margin-bottom:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${title}</a>
  <p style="color:#4d5156;line-height:1.5;margin:0;">${description}</p>
  ${location ? `<div style="display:flex;align-items:center;gap:4px;margin-top:8px;color:#1a0dab;font-size:14px;">&#128205; ${location}</div>` : ""}
  ${suggestedHtml}
</div>`;

  return htmlWrapper("Google Search Ad", body);
}
