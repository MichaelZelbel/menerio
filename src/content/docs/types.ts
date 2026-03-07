import { ReactNode } from "react";

export interface DocHeading {
  id: string;
  title: string;
}

export interface DocPage {
  slug: string;
  title: string;
  description: string;
  category: string;
  headings: DocHeading[];
  content: () => ReactNode;
  searchText: string;
}

export interface DocCategory {
  name: string;
  slug: string;
  pages: { slug: string; title: string }[];
}
