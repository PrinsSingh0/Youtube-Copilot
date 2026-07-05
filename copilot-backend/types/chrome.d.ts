/** Chrome extension APIs used by this project */
declare namespace chrome {
  namespace runtime {
    interface MessageSender {
      tab?: { id?: number; windowId?: number; url?: string };
    }

    interface CaptureResponse {
      success?: boolean;
      url?: string;
      id?: string;
      error?: string;
    }

    const onMessage: {
      addListener(
        callback: (
          message: Record<string, unknown>,
          sender: MessageSender,
          sendResponse: (response?: CaptureResponse) => void
        ) => boolean | void
      ): void;
    };

    const lastError: { message?: string } | undefined;

    function sendMessage(
      message: unknown,
      responseCallback?: (response: CaptureResponse) => void
    ): void;
  }

  namespace tabs {
    function captureTab(
      tabId: number,
      options?: { format?: 'png' | 'jpeg' }
    ): Promise<string>;

    function captureVisibleTab(
      windowId: number,
      options?: { format?: 'png' | 'jpeg' }
    ): Promise<string>;

    function captureVisibleTab(
      options?: { format?: 'png' | 'jpeg' }
    ): Promise<string>;

    function update(
      tabId: number,
      updateProperties: { active?: boolean }
    ): Promise<Tab>;

    interface Tab {
      id?: number;
      windowId?: number;
      url?: string;
    }
  }
}


