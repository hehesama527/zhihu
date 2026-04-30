"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function TwitterLoginPage() {
  const router = useRouter();
  
  useEffect(() => {
    // 重定向到账号管理页面
    router.replace("/twitter/account");
  }, [router]);

  return (
    <div className="stack">
      <div className="empty-state">
        <p>正在跳转到账号管理页面...</p>
      </div>
    </div>
  );
}
