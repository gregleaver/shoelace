import { html } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { animateTo, stopAnimations } from '../../internal/animate';
import { waitForEvent } from '../../internal/event';
import Modal from '../../internal/modal';
import { lockBodyScrolling, unlockBodyScrolling } from '../../internal/scroll';
import ShoelaceElement from '../../internal/shoelace-element';
import { HasSlotController } from '../../internal/slot';
import { watch } from '../../internal/watch';
import { getAnimation, setDefaultAnimation } from '../../utilities/animation-registry';
import { LocalizeController } from '../../utilities/localize';
import '../icon-button/icon-button';
import styles from './dialog.styles';
import type { CSSResultGroup } from 'lit';

/**
 * @since 2.0
 * @status stable
 *
 * @dependency sl-icon-button
 *
 * @slot - The dialog's content.
 * @slot label - The dialog's label. Alternatively, you can use the `label` attribute.
 * @slot footer - The dialog's footer, usually one or more buttons representing various options.
 *
 * @event sl-show - Emitted when the dialog opens.
 * @event sl-after-show - Emitted after the dialog opens and all animations are complete.
 * @event sl-hide - Emitted when the dialog closes.
 * @event sl-after-hide - Emitted after the dialog closes and all animations are complete.
 * @event sl-initial-focus - Emitted when the dialog opens and is ready to receive focus. Calling
 *   `event.preventDefault()` will prevent focusing and allow you to set it on a different element, such as an input.
 * @event {{ source: 'close-button' | 'keyboard' | 'overlay' }} sl-request-close - Emitted when the user attempts to
 *   close the dialog by clicking the close button, clicking the overlay, or pressing escape. Calling
 *   `event.preventDefault()` will keep the dialog open. Avoid using this unless closing the dialog will result in
 *   destructive behavior such as data loss.
 *
 * @csspart base - The component's internal wrapper.
 * @csspart overlay - The overlay.
 * @csspart panel - The dialog panel (where the dialog and its content is rendered).
 * @csspart header - The dialog header.
 * @csspart title - The dialog title.
 * @csspart close-button - The close button.
 * @csspart close-button__base - The close button's `base` part.
 * @csspart body - The dialog body.
 * @csspart footer - The dialog footer.
 *
 * @cssproperty --width - The preferred width of the dialog. Note that the dialog will shrink to accommodate smaller screens.
 * @cssproperty --header-spacing - The amount of padding to use for the header.
 * @cssproperty --body-spacing - The amount of padding to use for the body.
 * @cssproperty --footer-spacing - The amount of padding to use for the footer.
 *
 * @animation dialog.show - The animation to use when showing the dialog.
 * @animation dialog.hide - The animation to use when hiding the dialog.
 * @animation dialog.denyClose - The animation to use when a request to close the dialog is denied.
 * @animation dialog.overlay.show - The animation to use when showing the dialog's overlay.
 * @animation dialog.overlay.hide - The animation to use when hiding the dialog's overlay.
 */
@customElement('sl-dialog')
export default class SlDialog extends ShoelaceElement {
  static styles: CSSResultGroup = styles;

  @query('.dialog') dialog: HTMLElement;
  @query('.dialog__panel') panel: HTMLElement;
  @query('.dialog__overlay') overlay: HTMLElement;

  private readonly hasSlotController = new HasSlotController(this, 'footer');
  private readonly localize = new LocalizeController(this);
  private modal: Modal;
  private originalTrigger: HTMLElement | null;

  /** Indicates whether or not the dialog is open. You can use this in lieu of the show/hide methods. */
  @property({ type: Boolean, reflect: true }) open = false;

  /**
   * The dialog's label as displayed in the header. You should always include a relevant label even when using
   * `no-header`, as it is required for proper accessibility. If you need to display HTML, you can use the `label` slot
   * instead.
   */
  @property({ reflect: true }) label = '';

  /**
   * Disables the header. This will also remove the default close button, so please ensure you provide an easy,
   * accessible way for users to dismiss the dialog.
   */
  @property({ attribute: 'no-header', type: Boolean, reflect: true }) noHeader = false;

  connectedCallback() {
    super.connectedCallback();
    this.modal = new Modal(this);
  }

  firstUpdated() {
    this.dialog.hidden = !this.open;

    if (this.open) {
      this.modal.activate();
      lockBodyScrolling(this);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    unlockBodyScrolling(this);
  }

  /** Shows the dialog. */
  async show() {
    if (this.open) {
      return undefined;
    }

    this.open = true;
    return waitForEvent(this, 'sl-after-show');
  }

  /** Hides the dialog */
  async hide() {
    if (!this.open) {
      return undefined;
    }

    this.open = false;
    return waitForEvent(this, 'sl-after-hide');
  }

  private requestClose(source: 'close-button' | 'keyboard' | 'overlay') {
    const slRequestClose = this.emit('sl-request-close', {
      cancelable: true,
      detail: { source }
    });

    if (slRequestClose.defaultPrevented) {
      const animation = getAnimation(this, 'dialog.denyClose', { dir: this.localize.dir() });
      animateTo(this.panel, animation.keyframes, animation.options);
      return;
    }

    this.hide();
  }

  handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.requestClose('keyboard');
    }
  }

  @watch('open', { waitUntilFirstUpdate: true })
  async handleOpenChange() {
    if (this.open) {
      // Show
      this.emit('sl-show');
      this.originalTrigger = document.activeElement as HTMLElement;
      this.modal.activate();

      lockBodyScrolling(this);

      // When the dialog is shown, Safari will attempt to set focus on whatever element has autofocus. This can cause
      // the dialogs's animation to jitter (if it starts offscreen), so we'll temporarily remove the attribute, call
      // `focus({ preventScroll: true })` ourselves, and add the attribute back afterwards.
      //
      // Related: https://github.com/shoelace-style/shoelace/issues/693
      //
      const autoFocusTarget = this.querySelector('[autofocus]');
      if (autoFocusTarget) {
        autoFocusTarget.removeAttribute('autofocus');
      }

      await Promise.all([stopAnimations(this.dialog), stopAnimations(this.overlay)]);
      this.dialog.hidden = false;

      // Set initial focus
      requestAnimationFrame(() => {
        const slInitialFocus = this.emit('sl-initial-focus', { cancelable: true });

        if (!slInitialFocus.defaultPrevented) {
          // Set focus to the autofocus target and restore the attribute
          if (autoFocusTarget) {
            (autoFocusTarget as HTMLInputElement).focus({ preventScroll: true });
          } else {
            this.panel.focus({ preventScroll: true });
          }
        }

        // Restore the autofocus attribute
        if (autoFocusTarget) {
          autoFocusTarget.setAttribute('autofocus', '');
        }
      });

      const panelAnimation = getAnimation(this, 'dialog.show', { dir: this.localize.dir() });
      const overlayAnimation = getAnimation(this, 'dialog.overlay.show', { dir: this.localize.dir() });
      await Promise.all([
        animateTo(this.panel, panelAnimation.keyframes, panelAnimation.options),
        animateTo(this.overlay, overlayAnimation.keyframes, overlayAnimation.options)
      ]);

      this.emit('sl-after-show');
    } else {
      // Hide
      this.emit('sl-hide');
      this.modal.deactivate();

      await Promise.all([stopAnimations(this.dialog), stopAnimations(this.overlay)]);
      const panelAnimation = getAnimation(this, 'dialog.hide', { dir: this.localize.dir() });
      const overlayAnimation = getAnimation(this, 'dialog.overlay.hide', { dir: this.localize.dir() });

      // Animate the overlay and the panel at the same time. Because animation durations might be different, we need to
      // hide each one individually when the animation finishes, otherwise the first one that finishes will reappear
      // unexpectedly. We'll unhide them after all animations have completed.
      await Promise.all([
        animateTo(this.overlay, overlayAnimation.keyframes, overlayAnimation.options).then(() => {
          this.overlay.hidden = true;
        }),
        animateTo(this.panel, panelAnimation.keyframes, panelAnimation.options).then(() => {
          this.panel.hidden = true;
        })
      ]);

      this.dialog.hidden = true;

      // Now that the dialog is hidden, restore the overlay and panel for next time
      this.overlay.hidden = false;
      this.panel.hidden = false;

      unlockBodyScrolling(this);

      // Restore focus to the original trigger
      const trigger = this.originalTrigger;
      if (typeof trigger?.focus === 'function') {
        setTimeout(() => trigger.focus());
      }

      this.emit('sl-after-hide');
    }
  }

  render() {
    /* eslint-disable lit-a11y/click-events-have-key-events */
    return html`
      <div
        part="base"
        class=${classMap({
          dialog: true,
          'dialog--open': this.open,
          'dialog--has-footer': this.hasSlotController.test('footer')
        })}
        @keydown=${this.handleKeyDown}
      >
        <div part="overlay" class="dialog__overlay" @click=${() => this.requestClose('overlay')} tabindex="-1"></div>

        <div
          part="panel"
          class="dialog__panel"
          role="dialog"
          aria-modal="true"
          aria-hidden=${this.open ? 'false' : 'true'}
          aria-label=${ifDefined(this.noHeader ? this.label : undefined)}
          aria-labelledby=${ifDefined(!this.noHeader ? 'title' : undefined)}
          tabindex="0"
        >
          ${!this.noHeader
            ? html`
                <header part="header" class="dialog__header">
                  <h2 part="title" class="dialog__title" id="title">
                    <slot name="label"> ${this.label.length > 0 ? this.label : String.fromCharCode(65279)} </slot>
                  </h2>
                  <sl-icon-button
                    part="close-button"
                    exportparts="base:close-button__base"
                    class="dialog__close"
                    name="x"
                    label=${this.localize.term('close')}
                    library="system"
                    @click="${() => this.requestClose('close-button')}"
                  ></sl-icon-button>
                </header>
              `
            : ''}

          <div part="body" class="dialog__body">
            <slot></slot>
          </div>

          <footer part="footer" class="dialog__footer">
            <slot name="footer"></slot>
          </footer>
        </div>
      </div>
    `;
    /* eslint-enable lit-a11y/click-events-have-key-events */
  }
}

setDefaultAnimation('dialog.show', {
  keyframes: [
    { opacity: 0, transform: 'scale(0.8)' },
    { opacity: 1, transform: 'scale(1)' }
  ],
  options: { duration: 250, easing: 'ease' }
});

setDefaultAnimation('dialog.hide', {
  keyframes: [
    { opacity: 1, transform: 'scale(1)' },
    { opacity: 0, transform: 'scale(0.8)' }
  ],
  options: { duration: 250, easing: 'ease' }
});

setDefaultAnimation('dialog.denyClose', {
  keyframes: [{ transform: 'scale(1)' }, { transform: 'scale(1.02)' }, { transform: 'scale(1)' }],
  options: { duration: 250 }
});

setDefaultAnimation('dialog.overlay.show', {
  keyframes: [{ opacity: 0 }, { opacity: 1 }],
  options: { duration: 250 }
});

setDefaultAnimation('dialog.overlay.hide', {
  keyframes: [{ opacity: 1 }, { opacity: 0 }],
  options: { duration: 250 }
});

declare global {
  interface HTMLElementTagNameMap {
    'sl-dialog': SlDialog;
  }
}
