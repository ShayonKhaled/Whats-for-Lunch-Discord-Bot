/**
 * src/commands/dispatch.js
 *
 * `/dispatch` — Discord-native admin control command restricted to members
 * holding a role listed in `DASHBOARD_ADMIN_ROLE_ID` (or `BOT_ADMIN_ID` /
 * Discord Administrator permission if `DASHBOARD_ADMIN_ROLE_ID` is unset).
 *
 * Gives server admins full manual dispatch, live server/DB/bot diagnostics,
 * and 21-day pipeline checks directly inside Discord — with zero public web
 * URL, tunnel, or port forwarding required.
 *
 * Subcommands:
 *   /dispatch send    — Manually send, retry, or force-resend a campus menu
 *   /dispatch status  — Check live Host/PostgreSQL/Discord health & channel perms
 *   /dispatch check   — Run upcoming 21-day scraper data-quality check (with optional repair)
 */

const {
  SlashCommandBuilder,
  ChannelType,
  MessageFlags,
} = require('discord.js');
const db = require('../db');
const logger = require('../utils/logger');
const dashboardAuth = require('../dashboard/auth');
const publishRunner = require('../dashboard/publishRunner');
const menuPublisher = require('../publishers/menuPublisher');
const server = require('../server');
const { todayCampus, shiftDate } = require('../utils/campusDate');
const { KNOWN_CAMPUSES } = require('../utils/dataQuality');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function formatUptime(sec) {
  if (!sec || sec < 60) return `${sec || 0}s`;
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dispatch')
    .setDescription('Admin controls: manually send menus, check bot/server health, or inspect menu data')
    .addSubcommand((sub) =>
      sub
        .setName('send')
        .setDescription('Manually send or retry a campus menu right now')
        .addStringOption((opt) =>
          opt
            .setName('campus')
            .setDescription('Campus to send (omit to send both Uzumasa & Kameoka)')
            .setRequired(false)
            .addChoices(
              { name: 'Uzumasa Campus', value: 'Uzumasa' },
              { name: 'Kameoka Campus', value: 'Kameoka' }
            )
        )
        .addStringOption((opt) =>
          opt
            .setName('date')
            .setDescription('Menu date in YYYY-MM-DD (defaults to today JST)')
            .setRequired(false)
        )
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Optional: narrow delivery to a single subscribed channel')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false)
        )
        .addBooleanOption((opt) =>
          opt
            .setName('force')
            .setDescription('Force re-send even if this menu was already posted today')
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('status')
        .setDescription('View live server, PostgreSQL, Discord Gateway, and channel permission status')
    )
    .addSubcommand((sub) =>
      sub
        .setName('check')
        .setDescription('Run the 21-day upcoming scraper data-quality check')
        .addBooleanOption((opt) =>
          opt
            .setName('repair')
            .setDescription('Automatically repair provable unknown-campus rows in PostgreSQL')
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: '❌ Run `/dispatch` inside your Discord server so your admin role can be verified.',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!dashboardAuth.memberHasDashboardAccess(interaction.member)) {
      const configuredRoles = dashboardAuth.getAllowedRoleIds();
      const roleHint = configuredRoles.length
        ? `Requires one of the configured admin role(s): ${configuredRoles.map((id) => `<@&${id}>`).join(', ')}.`
        : 'Requires Discord **Administrator** permission.';

      logger.warn(`🔒 Denied /dispatch access for ${interaction.user.tag} (${interaction.user.id}) in ${interaction.guild?.name}`);
      return interaction.reply({
        content: `🔒 **Access Denied**\n${roleHint}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const subcommand = interaction.options.getSubcommand();
    const actor =
      interaction.member?.displayName ||
      interaction.user?.globalName ||
      interaction.user?.username ||
      'Admin';

    // ── /dispatch send ───────────────────────────────────────────────────────
    if (subcommand === 'send') {
      const campus = interaction.options.getString('campus') || undefined;
      const date = interaction.options.getString('date')?.trim() || undefined;
      const channel = interaction.options.getChannel('channel') || null;
      const force = Boolean(interaction.options.getBoolean('force'));

      if (date && !DATE_RE.test(date)) {
        return interaction.reply({
          content: `❌ Invalid date \`${date}\`. Please use \`YYYY-MM-DD\` (e.g. \`${todayCampus()}\`).`,
          flags: MessageFlags.Ephemeral,
        });
      }

      if (campus && !KNOWN_CAMPUSES.includes(campus)) {
        return interaction.reply({
          content: `❌ Unknown campus \`${campus}\`.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      if (publishRunner.getState().running) {
        return interaction.reply({
          content: '⏳ A publish run is already in progress. Wait a few seconds and try again.',
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const targetDesc = [
        campus || 'All campuses',
        channel ? `<#${channel.id}>` : 'all subscribed channels',
        date || `${todayCampus()} (today JST)`,
        force ? 'force re-send ON' : 'safe retry mode',
      ].join(' · ');

      logger.info(`📨 /dispatch send triggered by @${actor} (${interaction.user.id}): ${targetDesc}`);

      try {
        const summary = await menuPublisher.publishMenu(interaction.client, {
          manual: true,
          campus,
          channelId: channel?.id,
          date,
          force,
        });

        if (summary?.error) {
          return interaction.editReply({
            content: `❌ **Manual Dispatch Failed**\n• Target: ${targetDesc}\n• Error: \`${summary.error}\``,
          });
        }

        const sent = summary?.sent ?? 0;
        const skipped = summary?.skipped ?? 0;
        const failed = summary?.failed ?? 0;
        const targetDate = summary?.date || date || todayCampus();

        const header = failed > 0
          ? '⚠️ **Manual Dispatch Completed with Errors**'
          : sent > 0
            ? '✅ **Manual Dispatch Sent!**'
            : 'ℹ️ **Manual Dispatch Completed (Nothing Sent)**';

        const notes = [];
        if (sent === 0 && skipped > 0 && !force) {
          notes.push('💡 Channels were skipped because this date was already delivered. Re-run with `force: True` to post again.');
        } else if (summary && summary.anyMenuAvailable === false) {
          notes.push(`📭 No scraped menu rows were found in PostgreSQL for \`${targetDate}\`.`);
        }

        return interaction.editReply({
          content: [
            header,
            `• **Date:** \`${targetDate}\``,
            `• **Target:** ${campus || 'All campuses'} · ${channel ? `<#${channel.id}>` : 'All subscribed channels'}${force ? ' · **Force ON**' : ''}`,
            `• **Result:** **${sent} sent**, ${skipped} skipped, ${failed} failed`,
            ...notes,
          ].join('\n'),
        });
      } catch (err) {
        logger.error(`Error in /dispatch send: ${err.message}`);
        return interaction.editReply({
          content: `❌ **Manual Dispatch Failed:** \`${err.message}\``,
        });
      }
    }

    // ── /dispatch status ─────────────────────────────────────────────────────
    if (subcommand === 'status') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      try {
        const [status, subs] = await Promise.all([
          server.buildStatus(),
          db.getActiveSubscriptions().catch(() => []),
        ]);

        const subChecks = subs.map((s) => server.inspectSubscriptionConnection(interaction.client, s));
        const channelLines = subChecks.length
          ? subChecks.map((s) => {
              const icon = s.canSend ? '🟢' : '🔴';
              return `  ${icon} **${s.campus}** → <#${s.channelId}> (${s.connectionDetail})`;
            })
          : ['  *(No active channel subscriptions found)*'];

        const horizonLines = (status.pipelineHorizon || []).length
          ? status.pipelineHorizon.map(
              (h) => `  • **${h.campus}:** ${h.upcomingItems} dishes scraped through \`${h.latestDate}\` (${h.upcomingDays}d)`
            )
          : ['  • *(No upcoming scraped menus found)*'];

        const dbLine = status.databaseConnected
          ? `🟢 Connected (${status.dbLatencyMs ?? '—'} ms${status.dbPool ? ` · pool ${status.dbPool.totalCount} open / ${status.dbPool.idleCount} idle` : ''})`
          : '🔴 Unreachable';

        const dcLine = status.discordConnected
          ? `🟢 Connected (${status.wsPingMs ?? '—'} ms WS · ${status.guilds} server${status.guilds === 1 ? '' : 's'})`
          : '🔴 Disconnected';

        return interaction.editReply({
          content: [
            `🩺 **Bot & Server Status** (${status.healthy ? '🟢 Healthy' : '🔴 Degraded'})`,
            '',
            `• **Host ↔ PostgreSQL:** ${dbLine}`,
            `• **Bot ↔ Discord:** ${dcLine}`,
            `• **Host Runtime:** Up ${formatUptime(status.uptimeSeconds)} · ${status.host?.rssMb ?? '—'} MB RSS · Schedule: ${status.scheduler?.postingTime || '6:00 AM JST'}`,
            `• **Last Delivery:** ${status.lastDelivery ? `\`${status.lastDelivery.menuDate}\`` : 'None recorded'}`,
            '',
            '**Subscribed Channels:**',
            ...channelLines,
            '',
            '**Upcoming Scraper Horizon:**',
            ...horizonLines,
          ].join('\n'),
        });
      } catch (err) {
        logger.error(`Error in /dispatch status: ${err.message}`);
        return interaction.editReply({
          content: `❌ Could not load status: \`${err.message}\``,
        });
      }
    }

    // ── /dispatch check ──────────────────────────────────────────────────────
    if (subcommand === 'check') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const shouldRepair = Boolean(interaction.options.getBoolean('repair'));

      try {
        let repairNote = null;
        if (shouldRepair) {
          const windowDays = Math.min(Math.max(parseInt(process.env.DATA_CHECK_WINDOW_DAYS, 10) || 21, 1), 90);
          const today = todayCampus();
          const to = shiftDate(today, windowDays);
          logger.info(`🧹 /dispatch check repair=true triggered by @${actor} (${interaction.user.id})`);
          const report = await db.repairUnknownCampus(today, to, { apply: true });
          repairNote = `🧹 **Repair ran:** relabelled **${report.relabelled}** row(s), removed **${report.deleted}** duplicate(s).`;
        }

        const health = await server.buildDataHealth();
        const problemLines = health.problems.slice(0, 10).map((p) => `  • ${p}`);
        if (health.problems.length > 10) {
          problemLines.push(`  • *…and ${health.problems.length - 10} more*`);
        }

        const lines = [
          health.ok
            ? `✅ **Upcoming Menu Data Healthy** (\`${health.from}\` → \`${health.to}\`)`
            : `⚠️ **Menu Data Issues Detected** (\`${health.from}\` → \`${health.to}\`)`,
          `• Checked **${health.checked.rows}** rows across **${health.checked.weekdays.length}** upcoming weekday(s).`,
        ];

        if (repairNote) lines.push(repairNote);
        if (problemLines.length) {
          lines.push('', '**Issues:**', ...problemLines);
        }
        if (!shouldRepair && health.repairPreview?.relabelled > 0) {
          lines.push(
            '',
            `💡 **${health.repairPreview.relabelled}** mislabelled row(s) can be auto-fixed — re-run \`/dispatch check repair:True\`.`
          );
        }

        return interaction.editReply({ content: lines.join('\n') });
      } catch (err) {
        logger.error(`Error in /dispatch check: ${err.message}`);
        return interaction.editReply({
          content: `❌ Pipeline data check failed: \`${err.message}\``,
        });
      }
    }

    return interaction.reply({
      content: '❌ Unknown subcommand.',
      flags: MessageFlags.Ephemeral,
    });
  },
};
