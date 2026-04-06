"""
Email Agent - Email reading and management with memory

Purpose: Read, search, and manage your email inbox (Gmail and/or Outlook)
Pattern: Use ConnectOnion email tools + Memory system + Calendar + Shell + Plugins
"""

import json
import os
from connectonion import Agent, WebFetch, Shell, TodoList
from memory import Memory
from connectonion.useful_plugins import re_act, gmail_plugin, calendar_plugin
from automation.automation import pause_automation, resume_automation, is_automation_running


# Create shared tool instances
memory = Memory(memory_dir="data/memory")
read_memory = memory.read_memory
write_memory = memory.write_memory
update_memory = memory.update_memory
list_memories = memory.list_memories
search_memory = memory.search_memory
web = WebFetch()  # For analyzing contact domains
shell = Shell()  # For running shell commands (e.g., get current date)
todo = TodoList()  # For tracking multi-step tasks

# Build tools list based on .env flags
# Note: Only one email provider at a time (tools have overlapping method names)
has_gmail = os.getenv("LINKED_GMAIL", "").lower() == "true"
has_outlook = os.getenv("LINKED_OUTLOOK", "").lower() == "true"

tools = []
plugins = [re_act]

# Email/calendar tool instances (full instance kept for CRM agent)
email_instance = None
calendar_instance = None

# Prefer Gmail if both are linked (can only use one due to method name conflicts)
if has_gmail:
    from connectonion import Gmail, GoogleCalendar
    email_instance = Gmail()
    calendar_instance = GoogleCalendar()
    plugins.append(gmail_plugin)
    plugins.append(calendar_plugin)
elif has_outlook:
    from connectonion import Outlook, MicrosoftCalendar
    email_instance = Outlook()
    calendar_instance = MicrosoftCalendar()

# Warn if no email provider configured
if not email_instance:
    print("\n⚠️  No email account connected. Use /link-gmail or /link-outlook to connect.\n")

# Select prompt based on linked provider
if has_gmail:
    system_prompt = "prompts/jacks_gmail_agent.md"
elif has_outlook:
    system_prompt = "prompts/outlook_agent.md"
else:
    system_prompt = "prompts/jacks_gmail_agent.md"  # Default

# exclude the expensive API calls from the main agent so it stops calling them like an idiot
# the CRM init agent gets the full email instance, it can do what it likes
EXCLUDED_EMAIL_METHODS = {
    "get_all_contacts", "sync_contacts", "analyze_contact",
    "get_unanswered_emails", "get_cached_contacts", "update_contact",
    "bulk_update_contacts", "detect_all_my_emails", "get_all_my_emails",
    "sync_emails",
}

if email_instance:
    for name in dir(email_instance):
        if name.startswith("_") or name in EXCLUDED_EMAIL_METHODS:
            continue
        method = getattr(email_instance, name)
        if callable(method):
            tools.append(method)

if calendar_instance:
    tools.append(calendar_instance)

# Create init sub-agent for CRM database setup (gets full email instance)
crm_tools = [email_instance] if email_instance else []
init_crm = Agent(
    name="crm-init",
    system_prompt="prompts/jacks_crm_init.md",
    tools=crm_tools + [write_memory],
    max_iterations=30,
    model="co/gemini-3-flash-preview",
    log=False  # Don't create separate log file
)


def init_crm_database(max_emails: int = 500, exclude_domains: str = "openonion.ai,connectonion.com") -> str:
    """Initialize CRM database by extracting contacts.

    Args:
        max_emails: Number of emails to scan for contacts (default: 500)
        exclude_domains: Comma-separated domains to exclude (your org domains)

    Returns:
        Summary of initialization process including number of contacts analyzed
    """
    from pathlib import Path
    contacts_csv = Path("data/contacts.csv")

    if contacts_csv.exists():
        csv_content = contacts_csv.read_text()
        result = init_crm.input(
            f"Initialize CRM: contacts.csv already exists. Create contact files from the CSV data below.\n"
            f"DO NOT call get_all_contacts(). The data is already here.\n"
            f"Use AI judgment to only create files for real, important people.\n\n"
            f"--- contacts.csv ---\n{csv_content}"
        )
    else:
        result = init_crm.input(
            f"Initialize CRM: Extract contacts from up to {max_emails} latest emails.\n"
            f"IMPORTANT: Use get_all_contacts(max_emails={max_emails}, exclude_domains=\"{exclude_domains}\")\n"
            f"Then use AI judgment to only setup the most useful and important contacts."
        )
    # Return clear completion message so main agent knows not to call again
    return f"CRM INITIALIZATION COMPLETE. \n{result}\nContacts saved to memory/contacts, to browse contacts use list_memories('contacts')"


# Add remaining tools to the list
tools.extend([read_memory, write_memory, update_memory, search_memory, list_memories, shell, todo, init_crm_database, pause_automation, resume_automation, is_automation_running])

# Create main agent
agent = Agent(
    name="email-agent",
    system_prompt=system_prompt,
    tools=tools,
    plugins=plugins,
    max_iterations=15,
    model="co/gemini-3-flash-preview",
)

