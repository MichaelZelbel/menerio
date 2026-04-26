import { useState, useEffect } from "react";
import logoImg from "@/assets/logo.png";
import { Link, useNavigate } from "react-router-dom";
import { Menu, X, ChevronDown, Settings, LogOut, LayoutDashboard, Shield, Crown } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { NavLink } from "@/components/NavLink";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

const navLinks = [
  { label: "Home", to: "/" },
  { label: "Features", to: "/features" },
  { label: "Docs", to: "/docs" },
];

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const navigate = useNavigate();
  const { session, profile, role, signOut } = useAuth();
  const isLoggedIn = !!session;
  const isPremiumOrAdmin = role === "premium" || role === "premium_gift" || role === "admin";
  const userName = profile?.display_name || session?.user?.email || "User";

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const initials = userName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <header
      className={cn(
        "sticky top-0 z-50 w-full border-b border-[hsl(var(--landing-plain-white)/.06)] bg-[hsl(var(--landing-panel)/.86)] backdrop-blur-[14px] transition-all duration-200",
        scrolled && "shadow-[0_10px_30px_hsl(var(--landing-ink)/.24)]"
      )}
    >
      <div className="mx-auto flex h-16 max-w-[1240px] items-center justify-between px-6 md:px-9">
        <Link to="/" className="flex items-center gap-2">
          <img src={logoImg} alt="Menerio" className="h-8 w-8 object-contain" />
          <span className="font-display text-xl font-extrabold text-[hsl(var(--landing-text))]">Menerio</span>
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {navLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === "/"}
              className="rounded-full px-4 py-2 text-sm font-medium text-[hsl(var(--landing-muted))] transition-colors hover:bg-[hsl(var(--landing-plain-white)/.04)] hover:text-[hsl(var(--landing-text))]"
              activeClassName="bg-[hsl(var(--landing-sky-primary)/.14)] text-[hsl(var(--landing-sky-primary))]"
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="hidden md:flex items-center gap-2">
          <ThemeToggle />
          {isLoggedIn ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="flex items-center gap-2 px-2">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel className="flex items-center gap-2 font-normal">
                  <span className="text-sm font-medium truncate">{userName}</span>
                  {isPremiumOrAdmin && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-0.5 shrink-0">
                      {role === "admin" ? <Shield className="h-2.5 w-2.5" /> : <Crown className="h-2.5 w-2.5" />}
                      {role === "admin" ? "Admin" : "Premium"}
                    </Badge>
                  )}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate("/dashboard")}>
                  <LayoutDashboard className="mr-2 h-4 w-4" /> Dashboard
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/dashboard/settings")}>
                  <Settings className="mr-2 h-4 w-4" /> Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut className="mr-2 h-4 w-4" /> Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              <Button variant="ghost" size="sm" className="text-[hsl(var(--landing-muted))] hover:bg-[hsl(var(--landing-plain-white)/.04)] hover:text-[hsl(var(--landing-text))]" onClick={() => navigate("/auth")}>Sign In</Button>
              <Button size="sm" className="rounded-xl bg-[linear-gradient(180deg,hsl(var(--landing-button-top)),hsl(var(--landing-button-bottom)))] px-5 text-[hsl(var(--landing-plain-white))] shadow-[0_0_24px_hsl(var(--landing-sky-primary)/.35),inset_0_1px_0_hsl(var(--landing-plain-white)/.2)] hover:brightness-110" onClick={() => navigate("/auth?tab=signup")}>Get Started</Button>
            </>
          )}
        </div>

        <Button variant="ghost" size="icon" className="text-[hsl(var(--landing-text))] hover:bg-[hsl(var(--landing-plain-white)/.06)] md:hidden" onClick={() => setMobileOpen(!mobileOpen)} aria-label="Toggle menu">
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </div>

      {mobileOpen && (
        <div className="animate-fade-in border-t border-[hsl(var(--landing-plain-white)/.06)] bg-[hsl(var(--landing-panel))] md:hidden">
          <nav className="mx-auto flex max-w-[1240px] flex-col gap-1 px-6 py-4">
            {navLinks.map((link) => (
              <NavLink key={link.to} to={link.to} end={link.to === "/"} className="rounded-lg px-3 py-2.5 text-sm font-medium text-[hsl(var(--landing-muted))] transition-colors hover:bg-[hsl(var(--landing-plain-white)/.04)] hover:text-[hsl(var(--landing-text))]" activeClassName="bg-[hsl(var(--landing-sky-primary)/.14)] text-[hsl(var(--landing-sky-primary))]" onClick={() => setMobileOpen(false)}>
                {link.label}
              </NavLink>
            ))}
            <div className="mt-3 flex flex-col gap-2 border-t border-[hsl(var(--landing-plain-white)/.06)] pt-4">
              <div className="flex items-center justify-between px-3 py-1">
                <span className="text-sm text-[hsl(var(--landing-muted))]">Theme</span>
                <ThemeToggle />
              </div>
              {isLoggedIn ? (
                <>
                  <Button variant="ghost" className="justify-start" onClick={() => { navigate("/dashboard"); setMobileOpen(false); }}>
                    <LayoutDashboard className="mr-2 h-4 w-4" /> Dashboard
                  </Button>
                  <Button variant="ghost" className="justify-start" onClick={() => { navigate("/dashboard/settings"); setMobileOpen(false); }}>
                    <Settings className="mr-2 h-4 w-4" /> Settings
                  </Button>
                  <Button variant="ghost" className="justify-start text-destructive" onClick={handleSignOut}>
                    <LogOut className="mr-2 h-4 w-4" /> Sign Out
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="ghost" onClick={() => { navigate("/auth"); setMobileOpen(false); }}>Sign In</Button>
                  <Button onClick={() => { navigate("/auth?tab=signup"); setMobileOpen(false); }}>Get Started</Button>
                </>
              )}
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
