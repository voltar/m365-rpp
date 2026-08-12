import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const localizationDir = path.join(projectRoot, "src", "localization");

const phase2ByLocale = {
  es: {
    pageOverviewDescription: "Resumen operativo de planificación con cronograma, recursos, equipos y eventos de presencia.",
    pageTeamCapacityDescription: "Capacidad semanal del equipo con disponibilidad, proporción de ausencias y estado de riesgo.",
    pageMyAbsencesDescription: "Marcador de posición para ausencias personales y la futura vista general de solicitudes.",
    pageApprovalsDescription: "Marcador de posición para futuras aprobaciones y flujos de decisión.",
    pageTeamAdminDescription: "Administración central para aprobadores del equipo, suplentes, políticas y visibilidad de vacaciones.",
    pageReportsDescription: "Marcador de posición para informes, análisis y vistas de exportación.",
    pageSettingsDescription: "Configuración personal para solicitudes de ausencia, aprobadores, notificaciones y sincronización con Outlook.",
    pageInfoDescription: "Información sobre la aplicación, la arquitectura y la base del sistema de diseño.",
    infoPageDescription: "Una vista compacta y clara del propósito del producto, la arquitectura, el flujo de datos y la entrega.",
    infoFactsDescription: "Un resumen breve de la arquitectura, la operación y la colaboración entre los módulos principales."
  },
  fr: {
    pageOverviewDescription: "Vue d'ensemble opérationnelle de la planification avec chronologie, ressources, équipes et événements de présence.",
    pageTeamCapacityDescription: "Capacité hebdomadaire de l'équipe avec disponibilité, part d'absence et état de risque.",
    pageMyAbsencesDescription: "Espace réservé aux absences personnelles et à la future vue d'ensemble des demandes.",
    pageApprovalsDescription: "Espace réservé aux futures approbations et aux flux de décision.",
    pageTeamAdminDescription: "Administration centrale pour les approbateurs d'équipe, les remplaçants, les politiques et la visibilité des vacances.",
    pageReportsDescription: "Espace réservé aux rapports, analyses et vues d'exportation.",
    pageSettingsDescription: "Paramètres personnels pour les demandes d'absence, les approbateurs, les notifications et la synchronisation Outlook.",
    pageInfoDescription: "Informations sur l'application, l'architecture et la base du système de design.",
    infoPageDescription: "Une vue compacte et lisible du but du produit, de l'architecture, des flux de données et du déploiement.",
    infoFactsDescription: "Un aperçu bref de l'architecture, de l'exploitation et de la collaboration entre les modules principaux."
  },
  it: {
    pageOverviewDescription: "Panoramica operativa della pianificazione con timeline, risorse, team ed eventi di presenza.",
    pageTeamCapacityDescription: "Capacità settimanale del team con disponibilità, quota di assenze e stato di rischio.",
    pageMyAbsencesDescription: "Segnaposto per le assenze personali e la futura panoramica delle richieste.",
    pageApprovalsDescription: "Segnaposto per future approvazioni e flussi decisionali.",
    pageTeamAdminDescription: "Amministrazione centrale per approvatori del team, sostituti, politiche e visibilità delle ferie.",
    pageReportsDescription: "Segnaposto per report, analisi e viste di esportazione.",
    pageSettingsDescription: "Impostazioni personali per richieste di assenza, approvatori, notifiche e sincronizzazione Outlook.",
    pageInfoDescription: "Informazioni sull'applicazione, l'architettura e la base del sistema di design.",
    infoPageDescription: "Una vista compatta e leggibile dello scopo del prodotto, dell'architettura, del flusso dati e della distribuzione.",
    infoFactsDescription: "Una breve panoramica di architettura, operatività e collaborazione tra i moduli principali."
  },
  pt: {
    pageOverviewDescription: "Visão geral operacional do planeamento com cronograma, recursos, equipas e eventos de presença.",
    pageTeamCapacityDescription: "Capacidade semanal da equipa com disponibilidade, percentagem de ausência e estado de risco.",
    pageMyAbsencesDescription: "Espaço reservado para ausências pessoais e a futura visão geral dos pedidos.",
    pageApprovalsDescription: "Espaço reservado para futuras aprovações e fluxos de decisão.",
    pageTeamAdminDescription: "Administração central para aprovadores da equipa, substitutos, políticas e visibilidade de férias.",
    pageReportsDescription: "Espaço reservado para relatórios, análises e vistas de exportação.",
    pageSettingsDescription: "Definições pessoais para pedidos de ausência, aprovadores, notificações e sincronização com o Outlook.",
    pageInfoDescription: "Informação sobre a aplicação, a arquitetura e a base do sistema de design.",
    infoPageDescription: "Uma visão compacta e legível do propósito do produto, da arquitetura, do fluxo de dados e da entrega.",
    infoFactsDescription: "Um resumo breve da arquitetura, operação e colaboração entre os principais módulos."
  },
  ru: {
    pageOverviewDescription: "Оперативный обзор планирования с таймлайном, ресурсами, командами и событиями присутствия.",
    pageTeamCapacityDescription: "Недельная загрузка команды с доступностью, долей отсутствий и статусом риска.",
    pageMyAbsencesDescription: "Заглушка для личных отсутствий и будущего обзора заявок.",
    pageApprovalsDescription: "Заглушка для будущих согласований и процессов принятия решений.",
    pageTeamAdminDescription: "Центральное администрирование согласующих команды, заместителей, политик и видимости отпусков.",
    pageReportsDescription: "Заглушка для отчётов, аналитики и экранов экспорта.",
    pageSettingsDescription: "Личные настройки для заявок на отсутствие, согласующих, уведомлений и синхронизации Outlook.",
    pageInfoDescription: "Сведения о приложении, архитектуре и основе дизайн-системы.",
    infoPageDescription: "Компактный и понятный обзор назначения продукта, архитектуры, потока данных и поставки.",
    infoFactsDescription: "Краткий обзор архитектуры, эксплуатации и взаимодействия между ключевыми модулями."
  },
  zh: {
    pageOverviewDescription: "包含时间线、资源、团队和在场事件的运营规划总览。",
    pageTeamCapacityDescription: "按周显示团队容量，包含可用性、缺勤占比和风险状态。",
    pageMyAbsencesDescription: "用于个人缺勤和未来申请概览的占位内容。",
    pageApprovalsDescription: "用于未来审批和决策流程的占位内容。",
    pageTeamAdminDescription: "用于团队审批人、替补、策略和假期可见性的中央管理。",
    pageReportsDescription: "用于报表、分析和导出视图的占位内容。",
    pageSettingsDescription: "用于请假申请、审批人、通知和 Outlook 同步的个人设置。",
    pageInfoDescription: "关于应用、架构和设计系统基础的信息。",
    infoPageDescription: "一个简洁易读的视图，概述产品目标、架构、数据流和交付方式。",
    infoFactsDescription: "对核心模块架构、运行方式和协作关系的简要概览。"
  }
};

function renderLocaleFile(locale, overrides) {
  const lines = [
    'import type { de } from "./de";',
    'import { en } from "./en";',
    "",
    `export const ${locale} = {`,
    "  ...en,"
  ];

  for (const [key, value] of Object.entries(overrides)) {
    const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    lines.push(`  ${key}: "${escaped}",`);
  }

  lines.push("} satisfies Record<keyof typeof de, string>;");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  for (const [locale, overrides] of Object.entries(phase2ByLocale)) {
    const filePath = path.join(localizationDir, `${locale}.ts`);
    const content = renderLocaleFile(locale, overrides);
    await fs.writeFile(filePath, content, "utf8");
    console.log(`Phase 2 translated: ${locale}.ts`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
