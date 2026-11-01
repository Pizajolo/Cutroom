import { create } from 'zustand';
import type { ProjectDoc } from '@shared/schema/project';
import type { MediaFolder } from '../media/types';

export const PROJECT_TABS = ['Editor', 'Runs', 'Media', 'Backlog', 'Notes'] as const;
export type ProjectTab = typeof PROJECT_TABS[number];
export type Destination = 'home' | 'projects' | 'project' | 'media' | 'teams' | 'settings';
export const SETTINGS_SECTIONS = ['Accounts', 'Tools', 'Sandbox', 'Voice input', 'Render presets', 'Storage / snapshots', 'Extensions'] as const;
export type SettingsSection = typeof SETTINGS_SECTIONS[number];

export interface ProjectSession {
  project: ProjectDoc;
  rootPath: string;
}

interface NavigationState {
  destination: Destination;
  tab: ProjectTab;
  settingsSection: SettingsSection;
  project: ProjectSession | null;
  mediaFolder: MediaFolder | null;
  setMediaFolder: (folder: MediaFolder) => void;
  recentProjects: ProjectSession[];
  sidebarCollapsed: boolean;
  goalDraft: string;
  goalFocusRequest: number;
  navigate: (destination: Destination) => void;
  setTab: (tab: ProjectTab) => void;
  setSettingsSection: (section: SettingsSection) => void;
  openProject: (project: ProjectSession) => void;
  setRecentProjects: (projects: ProjectSession[]) => void;
  toggleSidebar: () => void;
  setGoalDraft: (draft: string) => void;
  focusGoal: () => void;
}

export const useNavigation = create<NavigationState>((set) => ({
  destination: 'home',
  tab: 'Editor',
  settingsSection: 'Accounts',
  project: null,
  mediaFolder: null,
  setMediaFolder: (mediaFolder) => set({ mediaFolder, destination: 'media' }),
  recentProjects: [],
  sidebarCollapsed: false,
  goalDraft: '',
  goalFocusRequest: 0,
  navigate: (destination) => set({ destination }),
  setTab: (tab) => set({ destination: 'project', tab }),
  setSettingsSection: (settingsSection) => set({ settingsSection }),
  openProject: (project) => set((state) => ({
    project, destination: 'project', tab: 'Editor',
    recentProjects: [project, ...state.recentProjects.filter((entry) => entry.project.id !== project.project.id)],
  })),
  setRecentProjects: (recentProjects) => set({ recentProjects }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setGoalDraft: (goalDraft) => set({ goalDraft }),
  focusGoal: () => set((state) => ({ destination: 'home', goalFocusRequest: state.goalFocusRequest + 1 })),
}));
