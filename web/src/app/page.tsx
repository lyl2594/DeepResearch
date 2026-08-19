// mini-deepresearch 教程根路由：直接跳转到 /chat（本教程无 landing 页）。
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function HomePage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/chat");
  }, [router]);

  return (
    <div className="flex h-screen w-screen items-center justify-center">
      <p className="text-muted-foreground">正在跳转到 /chat ...</p>
    </div>
  );
}
