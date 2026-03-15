"""
Core logic functions for Email Agent CLI.

These functions are shared by CLI commands and interactive slash commands.
"""

from connectonion import SlashCommand
from agent import agent


def _get_email_tool():
    """Get the first configured email tool (Gmail or Outlook)."""
    # Access via agent's tool registry
    if hasattr(agent.tools, 'gmail'):
        return agent.tools.gmail
    if hasattr(agent.tools, 'outlook'):
        return agent.tools.outlook
    return None


def do_inbox(count: int = 10, unread: bool = False) -> str:
    email = _get_email_tool()
    if not email:
        return "No email account connected. Use /link-gmail or /link-outlook to connect."
    return email.read_inbox(last=count, unread=unread)


def do_search(query: str, count: int = 10) -> str:
    email = _get_email_tool()
    if not email:
        return "No email account connected. Use /link-gmail or /link-outlook to connect."
    return email.search_emails(query=query, max_results=count)


def do_contacts() -> str:
    email = _get_email_tool()
    if not email:
        return "No email account connected. Use /link-gmail or /link-outlook to connect."
    # Gmail has get_cached_contacts, Outlook may not
    if hasattr(email, 'get_cached_contacts'):
        return email.get_cached_contacts()
    return "Contact caching not available for this provider."


def do_sync(max_emails: int = 500, exclude: str = "openonion.ai,connectonion.com") -> str:
    email = _get_email_tool()
    if not email:
        return "No email account connected. Use /link-gmail or /link-outlook to connect."
    if hasattr(email, 'sync_contacts'):
        return email.sync_contacts(max_emails=max_emails, exclude_domains=exclude)
    return "Contact syncing not available for this provider."


def do_init(max_emails: int = 500, top_n: int = 10, exclude: str = "openonion.ai,connectonion.com") -> str:
    from agent import init_crm_database
    return init_crm_database(max_emails=max_emails, top_n=top_n, exclude_domains=exclude)


def do_unanswered(days: int = 120, count: int = 20) -> str:
    email = _get_email_tool()
    if not email:
        return "No email account connected. Use /link-gmail or /link-outlook to connect."
    if hasattr(email, 'get_unanswered_emails'):
        return email.get_unanswered_emails(within_days=days, max_results=count)
    return "Unanswered email tracking not available for this provider."


def do_identity(detect: bool = False) -> str:
    email = _get_email_tool()
    if not email:
        return "No email account connected. Use /link-gmail or /link-outlook to connect."
    if detect and hasattr(email, 'detect_all_my_emails'):
        return email.detect_all_my_emails(max_emails=100)
    if hasattr(email, 'get_my_identity'):
        return email.get_my_identity()
    if hasattr(email, 'get_my_email'):
        return email.get_my_email()
    return "Identity detection not available for this provider."


def do_today() -> str:
    """Run /today command using SlashCommand."""
    from datetime import datetime, timedelta
    email = _get_email_tool()
    if not email:
        return "No email account connected. Use /link-gmail or /link-outlook to connect."

    cmd = SlashCommand.load("today")
    if not cmd:
        return "Command 'today' not found in commands/"

    # Get today's emails
    yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y/%m/%d')
    emails = email.search_emails(query=f"after:{yesterday}", max_results=50)

    # Replace {emails} placeholder in prompt
    prompt = cmd.prompt.replace("{emails}", emails)
    return agent.input(prompt)


def _get_calendar_tool():
    """Get the first configured calendar tool (Google or Microsoft)."""
    if hasattr(agent.tools, 'googlecalendar'):
        return agent.tools.googlecalendar
    if hasattr(agent.tools, 'microsoftcalendar'):
        return agent.tools.microsoftcalendar
    return None


def do_events(days: int = 7, unconfirmed: bool = False) -> str:
    """Extract events from recent emails using the /events slash command."""
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo
    aedt = ZoneInfo("Australia/Sydney")
    email = _get_email_tool()
    if not email:
        return "No email account connected. Use /link-gmail or /link-outlook to connect."

    cmd = SlashCommand.load("events")
    if not cmd:
        return "Command 'events' not found in commands/"

    # Search for date and time references in any common format
    since = (datetime.now(tz=aedt) - timedelta(days=days)).strftime('%Y/%m/%d')
    query = (
        f"after:{since} ("
        # Numeric date formats: DD/MM/YYYY, MM/DD/YYYY
        "\"/2025\" OR \"/2026\" OR \"/2027\" OR "
        # ISO date format: YYYY-MM-DD
        "\"-01-\" OR \"-02-\" OR \"-03-\" OR \"-04-\" OR \"-05-\" OR \"-06-\" OR "
        "\"-07-\" OR \"-08-\" OR \"-09-\" OR \"-10-\" OR \"-11-\" OR \"-12-\" OR "
        # Time formats
        "\"am\" OR \"pm\" OR \"o'clock\" OR "
        # Days of the week
        "Monday OR Tuesday OR Wednesday OR Thursday OR Friday OR Saturday OR Sunday OR "
        # Month names
        "January OR February OR March OR April OR May OR June OR "
        "July OR August OR September OR October OR November OR December OR "
        # Relative time references
        "tonight OR tomorrow OR \"next week\" OR \"this week\""
        ")"
    )
    emails_text = email.search_emails(query=query, max_results=50) or "No emails found."

    # Fetch existing calendar events so agent can skip already-added ones
    existing_events = ""
    if unconfirmed:
        cal = _get_calendar_tool()
        if cal:
            existing_events = cal.list_events(days_ahead=days) or ""

    prompt = (
        cmd.prompt
        .replace("{emails}", emails_text)
        .replace("{days}", str(days))
        .replace("{existing_events}", existing_events)
        .replace("{unconfirmed_only}", "true" if unconfirmed else "false")
    )
    return agent.input(prompt)


def do_ask(question: str) -> str:
    return agent.input(question)


def do_host(port: int = 8000, trust: str = "careful"):
    """Start the agent as an HTTP/WebSocket server."""
    from connectonion import host
    host(agent, port=port, trust=trust)
