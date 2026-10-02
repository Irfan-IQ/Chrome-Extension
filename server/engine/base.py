from abc import ABC, abstractmethod
from typing import AsyncIterator
from schemas import (
    ChatCompletionRequest,
    ChatCompletionResponse,
    ChatCompletionChunk,
    ChatCompletionChunkChoice,
    ChatCompletionChunkDelta,
)


class BaseEngine(ABC):
    @abstractmethod
    async def generate(self, req: ChatCompletionRequest) -> ChatCompletionResponse:
        pass

    async def generate_stream(
        self, req: ChatCompletionRequest
    ) -> AsyncIterator[ChatCompletionChunk]:
        """Default streaming generator wrapping generate()."""
        resp = await self.generate(req)
        choice = resp.choices[0] if resp.choices else None
        if not choice:
            return

        # Emit role announcement
        yield ChatCompletionChunk(
            id=resp.id,
            created=resp.created,
            model=resp.model,
            choices=[
                ChatCompletionChunkChoice(
                    index=0,
                    delta=ChatCompletionChunkDelta(role=choice.message.role),
                    finish_reason=None,
                )
            ],
        )

        # Emit content tokens
        if choice.message.content:
            tokens = choice.message.content.split(" ")
            for i, token in enumerate(tokens):
                text_part = token if i == len(tokens) - 1 else token + " "
                yield ChatCompletionChunk(
                    id=resp.id,
                    created=resp.created,
                    model=resp.model,
                    choices=[
                        ChatCompletionChunkChoice(
                            index=0,
                            delta=ChatCompletionChunkDelta(content=text_part),
                            finish_reason=None,
                        )
                    ],
                )

        # Emit tool calls if any
        if choice.message.tool_calls:
            yield ChatCompletionChunk(
                id=resp.id,
                created=resp.created,
                model=resp.model,
                choices=[
                    ChatCompletionChunkChoice(
                        index=0,
                        delta=ChatCompletionChunkDelta(tool_calls=choice.message.tool_calls),
                        finish_reason=None,
                    )
                ],
            )

        # Final chunk with finish reason
        yield ChatCompletionChunk(
            id=resp.id,
            created=resp.created,
            model=resp.model,
            choices=[
                ChatCompletionChunkChoice(
                    index=0,
                    delta=ChatCompletionChunkDelta(),
                    finish_reason=choice.finish_reason,
                )
            ],
        )

