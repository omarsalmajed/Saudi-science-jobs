import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Saudi Science Jobs | وظائف العلوم السعودية",
  description: "أحدث وظائف العلوم في المملكة العربية السعودية، محدثة كل 5 دقائق.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
