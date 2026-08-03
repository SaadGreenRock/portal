import Link from "next/link";

export default function NotFound() {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "100vh",
      textAlign: "center",
      padding: "2rem",
      fontFamily: "system-ui, sans-serif"
    }}>
      <h1 style={{ fontSize: "3rem", marginBottom: "1rem" }}>404 - Page Not Found</h1>
      <p style={{ fontSize: "1.2rem", color: "#666", marginBottom: "2rem" }}>
        The page or route you are looking for does not exist.
      </p>
      <Link 
        href="/"
        style={{
          padding: "0.75rem 1.5rem",
          backgroundColor: "#0070f3",
          color: "#fff",
          borderRadius: "6px",
          textDecoration: "none",
          fontWeight: 500
        }}
      >
        Return Home
      </Link>
    </div>
  );
}
