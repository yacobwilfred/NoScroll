from typing import List, Optional
from pydantic import BaseModel


class ContentNode(BaseModel):
    id: str
    title: str
    url: str
    content_type: str
    cluster_id: str
    source: Optional[str] = None
    summary: Optional[str] = None
    author: Optional[str] = None
    published_at: Optional[str] = None
    duration_minutes: Optional[int] = None
    read_time_minutes: Optional[int] = None
    language: str = "en"


class Direction(BaseModel):
    id: str                      # e.g. "dir_1"
    label: str                   # e.g. "Art & Design History"
    cluster_id: str              # the cluster this direction points into
    description: str             # short explanation of why this direction
    preview: ContentNode         # representative content item for this direction


class SessionStartRequest(BaseModel):
    prompt: str


class SessionStartResponse(BaseModel):
    session_id: str
    center_node: ContentNode
    directions: List[Direction]


class SessionExpandRequest(BaseModel):
    session_id: str
    current_node_id: str
    direction_id: str
    chosen_cluster_id: str       # cluster_id from the chosen Direction
    chosen_content_id: Optional[str] = None  # preview item ID — use this as new center if provided


class SessionExpandResponse(BaseModel):
    session_id: str
    center_node: ContentNode
    directions: List[Direction]
    breadcrumb: List[str]        # ordered list of content IDs visited so far


class ErrorResponse(BaseModel):
    detail: str
