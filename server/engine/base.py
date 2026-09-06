from abc import ABC, abstractmethod
from schemas import ChatCompletionRequest, ChatCompletionResponse


class BaseEngine(ABC):
    @abstractmethod
    async def generate(self, req: ChatCompletionRequest) -> ChatCompletionResponse:
        pass
