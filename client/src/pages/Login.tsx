import { useState } from "react";
import { useAppAuth } from "../contexts/AuthContext";
import { toast } from "sonner";

export default function Login() {
  const { login } = useAppAuth();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const ok = await login(password);
    setLoading(false);
    if (!ok) {
      toast.error("パスワードが正しくありません");
      setPassword("");
    }
  };

  return (
    <div className="min-h-screen bg-white flex">
      {/* Left: Red accent panel */}
      <div className="hidden md:flex w-1/3 bg-[oklch(0.48_0.22_27)] flex-col justify-between p-12">
        <div>
          <div className="w-12 h-12 bg-white mb-8" />
          <div className="text-white" style={{ fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif" }}>
            <p className="text-xs font-bold tracking-[0.2em] uppercase mb-6 opacity-60">System</p>
            <h1 className="text-4xl font-black leading-none mb-2">入庫</h1>
            <h1 className="text-4xl font-black leading-none mb-2">変換</h1>
            <h1 className="text-4xl font-black leading-none">アプリ</h1>
          </div>
        </div>
        <div className="text-white opacity-40 text-xs tracking-widest uppercase" style={{ fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif" }}>
          Nyuko Converter
        </div>
      </div>

      {/* Right: Login form */}
      <div className="flex-1 flex flex-col justify-center px-8 md:px-16 lg:px-24">
        <div className="max-w-sm w-full">
          {/* Mobile logo */}
          <div className="md:hidden flex items-center gap-3 mb-12">
            <div className="w-8 h-8 bg-[oklch(0.48_0.22_27)]" />
            <span className="text-xl font-black tracking-tight" style={{ fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif" }}>
              納品書→在庫入力csv作成
            </span>
          </div>

          <div className="mb-10">
            <p className="text-xs font-bold tracking-[0.2em] uppercase text-gray-400 mb-3" style={{ fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif" }}>
              Access
            </p>
            <div className="h-px bg-black mb-6" />
            <h2 className="text-3xl font-black tracking-tight" style={{ fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif" }}>
              ログイン
            </h2>
          </div>

          <form onSubmit={handleSubmit} className="space-y-0">
            <div className="mb-6">
              <label className="block text-xs font-bold tracking-[0.15em] uppercase mb-2 text-gray-500" style={{ fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif" }}>
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="パスワードを入力"
                required
                className="w-full border border-black px-4 py-3 text-sm font-medium bg-white focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-0"
                style={{ fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif", borderRadius: 0 }}
                autoFocus
              />
            </div>

            <button
              type="submit"
              disabled={loading || !password}
              className="w-full bg-black text-white py-3 text-sm font-bold tracking-[0.1em] uppercase hover:bg-[oklch(0.48_0.22_27)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif", borderRadius: 0 }}
            >
              {loading ? "認証中..." : "ログイン"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
