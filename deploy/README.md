# Deployment units

The units the bot host actually runs, kept here so a rebuild does not depend on
reading them back off the machine. All three are installed in
`/etc/systemd/system/` and assume the checkout lives at
`/root/Whats-for-Lunch-Discord-Bot`; adjust `WorkingDirectory`, `ExecStart` and
`EnvironmentFile` if yours differs.

| Unit | What it does |
|---|---|
| `wfl-bot.service` | The bot itself. Long-running, restarts on failure, reads `.env`. |
| `wfl-data-check.service` | One-shot: relabels menu rows it can prove were filed under the wrong campus, then validates the scraped data and DMs `BOT_ADMIN_ID` when what is left is wrong or incomplete. |
| `wfl-data-check.timer` | Runs the check at 05:30 JST on weekdays — half an hour before the 06:00 post, so bad data is reported before it is published. |

```bash
sudo cp deploy/systemd/*.service deploy/systemd/*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now wfl-bot.service
sudo systemctl enable --now wfl-data-check.timer
```

Note that `wfl-data-check.service` exits 1 when the data has problems and
`SuccessExitStatus=1` keeps that out of `systemctl --failed`: a red unit every
morning would hide a genuine crash. The alert is the DM, not the unit state.
