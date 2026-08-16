export default function Page() {
  return (
    <main style={{ fontFamily: "system-ui", padding: 40, maxWidth: 640 }}>
      <h1>Gray Reserve site chat</h1>
      <p>
        Shared chat endpoint for Gray Reserve sites. There is nothing to see here. The API is{" "}
        <code>POST /api/chat</code>; liveness is <code>GET /api/health</code>.
      </p>
    </main>
  );
}
