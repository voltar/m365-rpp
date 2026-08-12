// Apply core translations and fill missing keys across all locale files.
// This script is the Google-API-free workaround: English remains the fallback,
// while selected high-priority locales receive additional core UI translations.
// Run with: node scripts/apply-core-translations.mjs

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const localesDir = resolve(__dirname, "..", "src", "localization");

// English source is the authoritative fallback for all keys.
const enPath = resolve(localesDir, "en.ts");

const keyValueRegex = /^\s+([a-zA-Z0-9]+):\s*"((?:[^"\\]|\\.)*)",?\s*$/;

function splitLines(content) {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function parseLocaleFile(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const entries = {};
  for (const line of splitLines(content)) {
    const match = line.match(keyValueRegex);
    if (match) {
      entries[match[1]] = match[2].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
  }
  return entries;
}

function escapeValue(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildLocaleFile(locale, entries) {
  const lines = [
    'import type { de } from "./de";',
    'import { en } from "./en";',
    "",
    `export const ${locale} = {`,
    "  ...en,"
  ];

  for (const [key, value] of Object.entries(entries)) {
    lines.push(`  ${key}: "${escapeValue(value)}",`);
  }

  lines.push("} satisfies Record<keyof typeof de, string>;");
  lines.push("");
  return lines.join("\n");
}

// Core UI keys that should be translated in priority locales.
// These are app-level labels, navigation, common buttons, statuses, and error messages.
const coreTranslations = {
  "de-ch": {
    appTitle: "Ressourcen & Präsenzplanung",
    appSubtitle: "Betriebsplanung fuer IT-Ressourcen, Praesenz und Kapazitaet",
    appLogoAlt: "App-Logo M365 Ressourcen & Präsenzplanung",
    pageOverviewDescription: "Operative Planungsuebersicht mit Timeline, Ressourcen, Teams und Präsenzereignissen.",
    pageTeamCapacityDescription: "Wochenbasierte Teamkapazitaet mit Verfuegbarkeit, Abwesenheitsanteil und Risikostatus.",
    pageMyAbsencesDescription: "Platzhalter fuer persoenliche Abwesenheiten und spaetere Antragsuebersicht.",
    pageApprovalsDescription: "Platzhalter fuer spaetere Genehmigungen und Entscheidungsprozesse.",
    pageTeamAdminDescription: "Zentrale Administration fuer Team-Genehmiger, Stellvertretungen, Richtlinien und Ferienuebersicht.",
    pageReportsDescription: "Platzhalter fuer Berichte, Analysen und Exportansichten.",
    pageSettingsDescription: "Persoenliche Einstellungen fuer Ferienantraege, Genehmiger, Benachrichtigungen und Outlook-Synchronisation.",
    pageInfoDescription: "Informationen zur Anwendung, Architektur und Design-System-Grundlage.",
    navOverview: "Uebersicht",
    navTeamCapacity: "Teamkapazitaet",
    navMyAbsences: "Meine Abwesenheiten",
    navApprovals: "Genehmigungen",
    navTeamAdmin: "Team Admin Center",
    navReports: "Berichte",
    navSettings: "Einstellungen",
    navInfo: "Info",
    navAppAdmin: "App Admin Center",
    help: "Hilfe",
    headerSearch: "Suche",
    headerSearchPlaceholder: "Suche (Ctrl+E)",
    moreActions: "Weitere Aktionen",
    themeLight: "Hell",
    themeDark: "Dunkel",
    themeToggle: "Darstellung wechseln",
    timelinePeriodWeek: "Woche",
    timelinePeriodMonth: "Monat",
    timelineToday: "Heute",
    timelineFilter: "Filter",
    timelineFilterLabel: "Filter",
    timelineFilterPlaceholder: "Team oder Person suchen",
    detailsClose: "Schliessen",
    absenceCancel: "Abbrechen",
    absenceCreate: "Speichern",
    absenceUpdate: "Aenderungen speichern",
    absenceDelete: "Loeschen",
    errorRetryAction: "Erneut versuchen",
    planningBootstrapLoading: "Planungsdaten werden geladen ...",
    mySettingsSaveChanges: "Aenderungen speichern",
    mySettingsSaveError: "Einstellungen konnten nicht gespeichert werden",
    teamAdminSaveChanges: "Aenderungen speichern",
    teamAdminSaveError: "Team-Einstellungen konnten nicht gespeichert werden",
    footerText: "Microsoft Teams App Shell • Sprint 1 • Beobachtbarkeit EO-010"
  },

  es: {
    appTitle: "Planificación de Recursos y Presencia",
    appSubtitle: "Planificación operativa de recursos IT, presencia y capacidad",
    appLogoAlt: "Logotipo de la aplicación M365 Recursos y Planificación de Presencia",
    pageOverviewDescription: "Resumen operativo de planificación con cronología, recursos, equipos y eventos de presencia.",
    pageTeamCapacityDescription: "Capacidad semanal del equipo con disponibilidad, proporción de ausencias y estado de riesgo.",
    pageMyAbsencesDescription: "Marcador de posición para ausencias personales y la futura vista general de solicitudes.",
    pageApprovalsDescription: "Marcador de posición para futuras aprobaciones y flujos de decisión.",
    pageTeamAdminDescription: "Administración central para aprobadores del equipo, suplentes, políticas y visibilidad de vacaciones.",
    pageReportsDescription: "Marcador de posición para informes, análisis y vistas de exportación.",
    pageSettingsDescription: "Configuración personal para solicitudes de ausencia, aprobadores, notificaciones y sincronización con Outlook.",
    pageInfoDescription: "Información sobre la aplicación, la arquitectura y la base del sistema de diseño.",
    navOverview: "Resumen",
    navTeamCapacity: "Capacidad del equipo",
    navMyAbsences: "Mis ausencias",
    navApprovals: "Aprobaciones",
    navTeamAdmin: "Centro de Administración de Equipos",
    navReports: "Informes",
    navSettings: "Configuración",
    navInfo: "Información",
    navAppAdmin: "Centro de Administración de la App",
    help: "Ayuda",
    headerSearch: "Buscar",
    headerSearchPlaceholder: "Buscar (Ctrl+E)",
    moreActions: "Más acciones",
    themeLight: "Claro",
    themeDark: "Oscuro",
    themeToggle: "Cambiar apariencia",
    timelinePeriodWeek: "Semana",
    timelinePeriodMonth: "Mes",
    timelineToday: "Hoy",
    timelineFilter: "Filtro",
    timelineFilterLabel: "Filtro",
    timelineFilterPlaceholder: "Buscar equipo o persona",
    detailsClose: "Cerrar",
    absenceCancel: "Cancelar",
    absenceCreate: "Guardar",
    absenceUpdate: "Guardar cambios",
    absenceDelete: "Eliminar",
    errorRetryAction: "Reintentar",
    planningBootstrapLoading: "Cargando datos de planificación...",
    mySettingsSaveChanges: "Guardar cambios",
    mySettingsSaveError: "No se pudo guardar la configuración",
    teamAdminSaveChanges: "Guardar cambios",
    teamAdminSaveError: "No se pudieron guardar los ajustes del equipo",
    footerText: "Shell de aplicación de Microsoft Teams • Sprint 1 • Observabilidad EO-010"
  },

  fr: {
    appTitle: "Planification des ressources et de présence",
    appSubtitle: "Planification opérationnelle des ressources IT, de la présence et de la capacité",
    appLogoAlt: "Logo de l'application M365 Planification des ressources et de présence",
    pageOverviewDescription: "Vue d'ensemble opérationnelle de la planification avec chronologie, ressources, équipes et événements de présence.",
    pageTeamCapacityDescription: "Capacité hebdomadaire de l'équipe avec disponibilité, part d'absence et état de risque.",
    pageMyAbsencesDescription: "Espace réservé aux absences personnelles et à la future vue d'ensemble des demandes.",
    pageApprovalsDescription: "Espace réservé aux futures approbations et aux flux de décision.",
    pageTeamAdminDescription: "Administration centrale pour les approbateurs d'équipe, les remplaçants, les politiques et la visibilité des vacances.",
    pageReportsDescription: "Espace réservé aux rapports, analyses et vues d'exportation.",
    pageSettingsDescription: "Paramètres personnels pour les demandes d'absence, les approbateurs, les notifications et la synchronisation Outlook.",
    pageInfoDescription: "Informations sur l'application, l'architecture et la base du système de design.",
    navOverview: "Vue d'ensemble",
    navTeamCapacity: "Capacité d'équipe",
    navMyAbsences: "Mes absences",
    navApprovals: "Approbations",
    navTeamAdmin: "Centre d'administration d'équipe",
    navReports: "Rapports",
    navSettings: "Paramètres",
    navInfo: "Info",
    navAppAdmin: "Centre d'administration de l'application",
    help: "Aide",
    headerSearch: "Rechercher",
    headerSearchPlaceholder: "Rechercher (Ctrl+E)",
    moreActions: "Plus d'actions",
    themeLight: "Clair",
    themeDark: "Sombre",
    themeToggle: "Changer l'apparence",
    timelinePeriodWeek: "Semaine",
    timelinePeriodMonth: "Mois",
    timelineToday: "Aujourd'hui",
    timelineFilter: "Filtre",
    timelineFilterLabel: "Filtre",
    timelineFilterPlaceholder: "Rechercher une équipe ou une personne",
    detailsClose: "Fermer",
    absenceCancel: "Annuler",
    absenceCreate: "Enregistrer",
    absenceUpdate: "Enregistrer les modifications",
    absenceDelete: "Supprimer",
    errorRetryAction: "Réessayer",
    planningBootstrapLoading: "Chargement des données de planification...",
    mySettingsSaveChanges: "Enregistrer les modifications",
    mySettingsSaveError: "Les paramètres n'ont pas pu être enregistrés",
    teamAdminSaveChanges: "Enregistrer les modifications",
    teamAdminSaveError: "Les paramètres de l'équipe n'ont pas pu être enregistrés",
    footerText: "Coque d'application Microsoft Teams • Sprint 1 • Observabilité EO-010"
  },

  it: {
    appTitle: "Pianificazione risorse e presenza",
    appSubtitle: "Pianificazione operativa di risorse IT, presenza e capacità",
    appLogoAlt: "Logo dell'app M365 Pianificazione risorse e presenza",
    pageOverviewDescription: "Panoramica operativa della pianificazione con timeline, risorse, team ed eventi di presenza.",
    pageTeamCapacityDescription: "Capacità settimanale del team con disponibilità, quota di assenze e stato di rischio.",
    pageMyAbsencesDescription: "Segnaposto per le assenze personali e la futura panoramica delle richieste.",
    pageApprovalsDescription: "Segnaposto per future approvazioni e flussi decisionali.",
    pageTeamAdminDescription: "Amministrazione centrale per approvatori del team, sostituti, politiche e visibilità delle ferie.",
    pageReportsDescription: "Segnaposto per report, analisi e viste di esportazione.",
    pageSettingsDescription: "Impostazioni personali per richieste di assenza, approvatori, notifiche e sincronizzazione Outlook.",
    pageInfoDescription: "Informazioni sull'applicazione, l'architettura e la base del sistema di design.",
    navOverview: "Panoramica",
    navTeamCapacity: "Capacità del team",
    navMyAbsences: "Le mie assenze",
    navApprovals: "Approvazioni",
    navTeamAdmin: "Centro amministrazione team",
    navReports: "Report",
    navSettings: "Impostazioni",
    navInfo: "Info",
    navAppAdmin: "Centro amministrazione app",
    help: "Aiuto",
    headerSearch: "Cerca",
    headerSearchPlaceholder: "Cerca (Ctrl+E)",
    moreActions: "Altre azioni",
    themeLight: "Chiaro",
    themeDark: "Scuro",
    themeToggle: "Cambia aspetto",
    timelinePeriodWeek: "Settimana",
    timelinePeriodMonth: "Mese",
    timelineToday: "Oggi",
    timelineFilter: "Filtro",
    timelineFilterLabel: "Filtro",
    timelineFilterPlaceholder: "Cerca team o persona",
    detailsClose: "Chiudi",
    absenceCancel: "Annulla",
    absenceCreate: "Salva",
    absenceUpdate: "Salva modifiche",
    absenceDelete: "Elimina",
    errorRetryAction: "Riprova",
    planningBootstrapLoading: "Caricamento dati di pianificazione...",
    mySettingsSaveChanges: "Salva modifiche",
    mySettingsSaveError: "Impossibile salvare le impostazioni",
    teamAdminSaveChanges: "Salva modifiche",
    teamAdminSaveError: "Impossibile salvare le impostazioni del team",
    footerText: "Shell app Microsoft Teams • Sprint 1 • Osservabilità EO-010"
  },

  zh: {
    appTitle: "资源与在场规划",
    appSubtitle: "IT 资源、在场情况与容量的运营规划",
    appLogoAlt: "M365 资源与在场规划应用徽标",
    pageOverviewDescription: "包含时间线、资源、团队和在在场事件的运营规划总览。",
    pageTeamCapacityDescription: "按周显示团队容量，包含可用性、缺勤占比和风险状态。",
    pageMyAbsencesDescription: "用于个人缺勤和未来申请概览的占位内容。",
    pageApprovalsDescription: "用于未来审批和决策流程的占位内容。",
    pageTeamAdminDescription: "用于团队审批人、替补、策略和假期可见性的中央管理。",
    pageReportsDescription: "用于报表、分析和导出视图的占位内容。",
    pageSettingsDescription: "用于请假申请、审批人、通知和 Outlook 同步的个人设置。",
    pageInfoDescription: "关于应用、架构和设计系统基础的信息。",
    navOverview: "概览",
    navTeamCapacity: "团队容量",
    navMyAbsences: "我的缺勤",
    navApprovals: "审批",
    navTeamAdmin: "团队管理中心",
    navReports: "报表",
    navSettings: "设置",
    navInfo: "信息",
    navAppAdmin: "应用管理中心",
    help: "帮助",
    headerSearch: "搜索",
    headerSearchPlaceholder: "搜索 (Ctrl+E)",
    moreActions: "更多操作",
    themeLight: "浅色",
    themeDark: "深色",
    themeToggle: "切换外观",
    timelinePeriodWeek: "周",
    timelinePeriodMonth: "月",
    timelineToday: "今天",
    timelineFilter: "筛选",
    timelineFilterLabel: "筛选",
    timelineFilterPlaceholder: "搜索团队或人员",
    detailsClose: "关闭",
    absenceCancel: "取消",
    absenceCreate: "保存",
    absenceUpdate: "保存更改",
    absenceDelete: "删除",
    errorRetryAction: "重试",
    planningBootstrapLoading: "正在加载规划数据...",
    mySettingsSaveChanges: "保存更改",
    mySettingsSaveError: "无法保存设置",
    teamAdminSaveChanges: "保存更改",
    teamAdminSaveError: "无法保存团队设置",
    footerText: "Microsoft Teams 应用外壳 • Sprint 1 • 可观测性 EO-010"
  },

  ko: {
    appTitle: "리소스 및 프레즌스 계획",
    appSubtitle: "IT 리소스, 프레즌스 및 용량에 대한 운영 계획",
    appLogoAlt: "M365 리소스 및 프레즌스 계획 앱 로고",
    pageOverviewDescription: "타임라인, 리소스, 팀 및 프레즌스 이벤트가 포함된 운영 계획 개요입니다.",
    pageTeamCapacityDescription: "가용성, 결석 비율 및 위험 상태를 포함한 주간 팀 용량입니다.",
    pageMyAbsencesDescription: "개인 결석 및 향후 요청 개요를 위한 자리 표시자입니다.",
    pageApprovalsDescription: "향후 승인 및 의사 결정 워크플로를 위한 자리 표시자입니다.",
    pageTeamAdminDescription: "팀 승인자, 대리인, 정책 및 휴가 가시성을 위한 중앙 관리입니다.",
    pageReportsDescription: "보고, 분석 및 내보내기 보기를 위한 자리 표시자입니다.",
    pageSettingsDescription: "부재 신청, 승인자, 알림 및 Outlook 동기화에 대한 개인 설정입니다.",
    pageInfoDescription: "애플리케이션, 아키텍처 및 디자인 시스템 기초에 대한 정보입니다.",
    navOverview: "개요",
    navTeamCapacity: "팀 용량",
    navMyAbsences: "내 부재",
    navApprovals: "승인",
    navTeamAdmin: "팀 관리자 센터",
    navReports: "보고서",
    navSettings: "설정",
    navInfo: "정보",
    navAppAdmin: "앱 관리자 센터",
    help: "도움말",
    headerSearch: "검색",
    headerSearchPlaceholder: "검색 (Ctrl+E)",
    moreActions: "추가 작업",
    themeLight: "밝게",
    themeDark: "어둡게",
    themeToggle: "모양 전환",
    timelinePeriodWeek: "주",
    timelinePeriodMonth: "월",
    timelineToday: "오늘",
    timelineFilter: "필터",
    timelineFilterLabel: "필터",
    timelineFilterPlaceholder: "팀 또는 사용자 검색",
    detailsClose: "닫기",
    absenceCancel: "취소",
    absenceCreate: "저장",
    absenceUpdate: "변경 사항 저장",
    absenceDelete: "삭제",
    errorRetryAction: "다시 시도",
    planningBootstrapLoading: "계획 데이터를 로드하는 중...",
    mySettingsSaveChanges: "변경 사항 저장",
    mySettingsSaveError: "설정을 저장할 수 없습니다",
    teamAdminSaveChanges: "변경 사항 저장",
    teamAdminSaveError: "팀 설정을 저장할 수 없습니다",
    footerText: "Microsoft Teams 앱 셸 • Sprint 1 • 관측성 EO-010"
  }
};

const enEntries = parseLocaleFile(enPath);
const allEnKeys = Object.keys(enEntries);

const localeFileNames = [
  { locale: "am", file: "am.ts" },
  { locale: "ar", file: "ar.ts" },
  { locale: "bn", file: "bn.ts" },
  { locale: "bho", file: "bho.ts" },
  { locale: "de-ch", file: "de-ch.ts" },
  { locale: "es", file: "es.ts" },
  { locale: "fa", file: "fa.ts" },
  { locale: "fr", file: "fr.ts" },
  { locale: "gu", file: "gu.ts" },
  { locale: "ha", file: "ha.ts" },
  { locale: "hi", file: "hi.ts" },
  { locale: "id", file: "id.ts" },
  { locale: "it", file: "it.ts" },
  { locale: "ja", file: "ja.ts" },
  { locale: "jv", file: "jv.ts" },
  { locale: "kn", file: "kn.ts" },
  { locale: "ko", file: "ko.ts" },
  { locale: "ml", file: "ml.ts" },
  { locale: "mr", file: "mr.ts" },
  { locale: "my", file: "my.ts" },
  { locale: "nl", file: "nl.ts" },
  { locale: "om", file: "om.ts" },
  { locale: "pa", file: "pa.ts" },
  { locale: "pcm", file: "pcm.ts" },
  { locale: "pl", file: "pl.ts" },
  { locale: "pt", file: "pt.ts" },
  { locale: "ru", file: "ru.ts" },
  { locale: "sw", file: "sw.ts" },
  { locale: "ta", file: "ta.ts" },
  { locale: "te", file: "te.ts" },
  { locale: "th", file: "th.ts" },
  { locale: "tr", file: "tr.ts" },
  { locale: "uk", file: "uk.ts" },
  { locale: "ur", file: "ur.ts" },
  { locale: "vi", file: "vi.ts" },
  { locale: "yue", file: "yue.ts" },
  { locale: "zh", file: "zh.ts" }
];

function applyInPlaceOverrides(filePath, overrides, missingFallbacks) {
  const content = readFileSync(filePath, "utf-8");
  const lineEnding = content.includes("\r\n") ? "\r\n" : "\n";

  // Normalize for processing.
  let normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Remove existing entries for overrides so the new value wins.
  for (const key of Object.keys(overrides)) {
    const regex = new RegExp(`^[ \\t]*${key}:[ \\t]*"(?:[^"\\\\]|\\\\.)*",?[ \\t]*\\n`, "m");
    normalized = normalized.replace(regex, "");
  }

  // Find the closing brace.
  const closingPattern = "} satisfies Record<keyof typeof de, string>;";
  const closingIndex = normalized.lastIndexOf(closingPattern);
  if (closingIndex === -1) {
    throw new Error(`Could not find closing brace in ${filePath}`);
  }

  const combined = { ...overrides, ...missingFallbacks };
  const entries = Object.entries(combined)
    .map(([key, value]) => `  ${key}: "${escapeValue(value)}",`)
    .join("\n");

  const patched = normalized.slice(0, closingIndex) + entries + "\n" + normalized.slice(closingIndex);
  writeFileSync(filePath, patched.replace(/\n/g, lineEnding), "utf-8");
}

for (const { locale, file } of localeFileNames) {
  const filePath = resolve(localesDir, file);
  const existing = parseLocaleFile(filePath);
  const core = coreTranslations[locale] ?? {};

  // Missing keys get English fallback values so TypeScript stays happy.
  const missingFallbacks = {};
  for (const key of allEnKeys) {
    if (!(key in existing) || !existing[key]) {
      missingFallbacks[key] = enEntries[key];
    }
  }

  // For de-ch, replace the whole file because the source overrides de.ts.
  if (locale === "de-ch") {
    const merged = { ...enEntries, ...core, ...existing };
    for (const key of allEnKeys) {
      if (!(key in merged) || !merged[key]) {
        merged[key] = enEntries[key];
      }
    }
    const content = buildLocaleFile(locale, merged);
    writeFileSync(filePath, content, "utf-8");
    console.log(`✅ ${locale}: ${Object.keys(merged).length}/${allEnKeys.length} keys, ${Object.keys(core).length} core overrides`);
    continue;
  }

  applyInPlaceOverrides(filePath, core, missingFallbacks);
  const totalKeys = Object.keys(parseLocaleFile(filePath)).length;
  console.log(`✅ ${locale}: ${totalKeys}/${allEnKeys.length} keys, ${Object.keys(core).length} core overrides, ${Object.keys(missingFallbacks).length} missing filled`);
}

console.log("\nDone! Run 'npm run build' to verify type safety.");
