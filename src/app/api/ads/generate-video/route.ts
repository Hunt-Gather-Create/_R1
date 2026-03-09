export async function POST(req: Request) {
  // Video generation is deferred — not yet implemented
  return Response.json(
    { error: "Video generation is not yet available" },
    { status: 501 }
  );
}
