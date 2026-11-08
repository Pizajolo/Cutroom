import { create } from 'zustand';
import type { ProjectCreateResult, ProjectSession, RecentProject } from '@shared/schema/project';
import type { InvokeRes } from '@shared/ipc';
import { api } from '../lib/api';
import { requestNavigation, useSettingsGuard } from './settingsDraft';
import type { MediaFolder } from '../media/types';

export type Destination = 'home' | 'projects' | 'project' | 'skills' | 'settings';
export const SETTINGS_SECTIONS = ['Accounts', 'Tools', 'Sandbox', 'Voice input', 'Render presets', 'Storage / snapshots', 'Extensions'] as const;
export type SettingsSection = typeof SETTINGS_SECTIONS[number];
export type { ProjectSession };
type NeedsCreate = Extract<InvokeRes<'project.open'>, { status: 'needsCreate' }>;
interface NavigationState {
  destination: Destination; settingsSection: SettingsSection;
  project: ProjectSession | null; recentProjects: RecentProject[]; mediaFolder: MediaFolder | null;
  loadingProjects: boolean; projectError: string | null; projectBusy: boolean;
  projectDialog: 'new' | NeedsCreate | null; importRecovery: ProjectCreateResult | null;
  goalDraft: string; goalFocusRequest: number;
  chatCollapsed: boolean; chatFocusRequest: number;
  dock: 'Media' | 'Inspector' | 'Audio' | 'Transcript'; sourceRel: string | null;
  navigate: (destination: Destination) => void;
  setSettingsSection: (section: SettingsSection) => void; openProject: (project: ProjectSession) => void;
  openRecent: (id: string) => Promise<void>; pickProject: () => Promise<void>;
  refreshRecent: () => Promise<void>; newProject: () => void;
  setGoalDraft: (draft: string) => void; focusGoal: () => void;
}
export const errorMessage = (reason: unknown) => reason instanceof Error ? reason.message : 'The request could not be completed.';
export const useNavigation = create<NavigationState>((set, get) => ({
  destination: 'home', settingsSection: 'Accounts', project: null, recentProjects: [], mediaFolder: null,
  loadingProjects: true, projectError: null, projectBusy: false, projectDialog: null, importRecovery: null,
  chatCollapsed: false, chatFocusRequest: 0, goalDraft: '', goalFocusRequest: 0, dock: 'Media', sourceRel: null,
  navigate: (destination) => requestNavigation(() => set({ destination })), setSettingsSection: (settingsSection) => { if (settingsSection !== get().settingsSection) requestNavigation(() => set({ settingsSection })); },
  openProject: (project) => { set({ project, mediaFolder: { id: project.project.id, root: project.rootPath }, destination: 'project', chatCollapsed: false, projectDialog: null, importRecovery: null, sourceRel: null }); void get().refreshRecent(); },
  openRecent: async (recentId) => {
    if (useSettingsGuard.getState().guard) { requestNavigation(() => { void get().openRecent(recentId); }); return; }
    if (get().projectBusy) return;
    set({ projectBusy: true, projectError: null });
    try { const result = await api.invoke('project.open', { recentId }); if (result.status === 'opened') get().openProject(result.session); else set({ projectDialog: result }); }
    catch (reason) { set({ projectError: errorMessage(reason) }); }
    finally { set({ projectBusy: false }); }
  },
  pickProject: async () => {
    if (useSettingsGuard.getState().guard) { requestNavigation(() => { void get().pickProject(); }); return; }
    if (get().projectBusy) return;
    set({ projectBusy: true, projectError: null });
    try {
      const grant = await api.invoke('dialog.pickFolder', { purpose: 'openProject' });
      if (!grant) return;
      const result = await api.invoke('project.open', { grantId: grant.grantId });
      if (result.status === 'opened') get().openProject(result.session); else set({ projectDialog: result });
    } catch (reason) { set({ projectError: errorMessage(reason) }); }
    finally { set({ projectBusy: false }); }
  },
  refreshRecent: async () => {
    try { const recentProjects = await api.invoke('project.listRecent', {}); set({ recentProjects, loadingProjects: false }); }
    catch (reason) { set({ projectError: errorMessage(reason), loadingProjects: false }); }
  },
  newProject: () => requestNavigation(() => set({ projectDialog: 'new' })),
  setGoalDraft: (goalDraft) => set({ goalDraft }), focusGoal: () => requestNavigation(() => set((state) => ({ destination: 'home', goalFocusRequest: state.goalFocusRequest + 1 }))),
}));

export function connectProjects(): () => void {
  let active = true, eventReceived = false;
  const remove = api.on('project.changed', (project) => {
    eventReceived = true;
    useNavigation.setState({ project, mediaFolder: project ? { id: project.project.id, root: project.rootPath } : null, ...(project?.project.id !== useNavigation.getState().project?.project.id ? { sourceRel: null } : {}) });
    void useNavigation.getState().refreshRecent();
  });
  void api.invoke('project.current', {}).then((project) => { if (active && !eventReceived) useNavigation.setState({ project, mediaFolder: project ? { id: project.project.id, root: project.rootPath } : null, ...(project?.project.id !== useNavigation.getState().project?.project.id ? { sourceRel: null } : {}) }); }).catch((reason: unknown) => { if (active) useNavigation.setState({ projectError: errorMessage(reason) }); });
  void useNavigation.getState().refreshRecent();
  return () => { active = false; remove(); };
}
